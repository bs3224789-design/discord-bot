const { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Хранилище игр
const games = new Map();

// ТОЛЬКО АНИМИРОВАННЫЙ GIF (снизу) - ЛОГОТИП УБРАН
const SMALL_GIF_URL = 'https://i.imgur.com/5Y7EpmD.gif';

// Команды
const commands = [
    {
        name: 'game',
        description: 'Создать новую игру в ветке',
        options: [
            {
                name: 'positions',
                description: 'Количество позиций (например 5)',
                type: 4,
                required: true
            }
        ]
    },
    {
        name: 'add',
        description: 'Добавить позиции',
        options: [
            {
                name: 'positions',
                description: 'Количество позиций',
                type: 4,
                required: true
            }
        ]
    },
    {
        name: 'clear',
        description: 'Очистить все позиции'
    },
    {
        name: 'show',
        description: 'Показать таблицу'
    },
    {
        name: 'remove',
        description: 'Убрать игрока с позиции',
        options: [
            {
                name: 'position',
                description: 'Номер позиции',
                type: 4,
                required: true
            }
        ]
    }
];

client.once('ready', async () => {
    console.log(`✅ Бот запущен! Имя: ${client.user.tag}`);
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Слеш-команды зарегистрированы!');
    } catch (error) {
        console.error(error);
    }
});

// Обработка команд
client.on('interactionCreate', async (interaction) => {
    if (interaction.isCommand()) {
        const channelId = interaction.channel.id;
        
        if (interaction.commandName === 'game') {
            const maxPos = interaction.options.getInteger('positions') || 10;
            
            try {
                const threadName = `🎮 Игра на ${maxPos} мест`;
                
                const existingThread = interaction.channel.threads.cache.find(
                    t => t.name === threadName && !t.archived
                );
                
                let targetThread = existingThread;
                
                if (!existingThread) {
                    targetThread = await interaction.channel.threads.create({
                        name: threadName,
                        autoArchiveDuration: 60,
                        type: ChannelType.PublicThread,
                        reason: 'Новая игра Битва Семей'
                    });
                    
                    await targetThread.send(`🎮 **Добро пожаловать в игру!**\n📊 **${maxPos}** позиций доступно.\n💡 Нажимай на кнопки чтобы занять место!`);
                }
                
                games.set(targetThread.id, { maxPosition: maxPos, players: {} });
                await showGameMenu(targetThread);
                
                await interaction.reply({ 
                    content: `✅ Создана ветка **${threadName}**! Переходи туда чтобы играть.`,
                    ephemeral: true 
                });
                
            } catch (error) {
                console.error(error);
                await interaction.reply({ 
                    content: '❌ Не удалось создать ветку. Проверь права бота.',
                    ephemeral: true 
                });
            }
            return;
        }
        
        if (interaction.commandName === 'add') {
            let game = games.get(channelId);
            if (!game) game = { maxPosition: 10, players: {} };
            const newMax = interaction.options.getInteger('positions');
            if (newMax > game.maxPosition) {
                game.maxPosition = newMax;
                games.set(channelId, game);
                await showGameMenu(interaction.channel);
                await interaction.reply({ content: `✅ Расширено до ${newMax} позиций!`, ephemeral: true });
            } else {
                await interaction.reply({ content: `❌ Число должно быть больше ${game.maxPosition}`, ephemeral: true });
            }
            return;
        }
        
        if (interaction.commandName === 'clear') {
            const game = games.get(channelId);
            if (game) game.players = {};
            await showGameMenu(interaction.channel);
            await interaction.reply({ content: '🧹 Все очищено!', ephemeral: true });
            return;
        }
        
        if (interaction.commandName === 'show') {
            await showGameMenu(interaction.channel);
            await interaction.reply({ content: '📊 Обновлено', ephemeral: true });
            return;
        }
        
        if (interaction.commandName === 'remove') {
            const game = games.get(channelId);
            if (game) {
                const pos = interaction.options.getInteger('position');
                if (game.players[pos]) {
                    delete game.players[pos];
                    await showGameMenu(interaction.channel);
                    await interaction.reply({ content: `✅ Позиция ${pos} свободна`, ephemeral: true });
                } else {
                    await interaction.reply({ content: `❌ Позиция ${pos} уже свободна`, ephemeral: true });
                }
            }
            return;
        }
    }
    
    // Обработка нажатий на кнопки
    if (interaction.isButton()) {
        const position = parseInt(interaction.customId);
        if (isNaN(position)) return;
        
        const game = games.get(interaction.channel.id);
        if (!game) {
            await interaction.reply({ content: '❌ Нет активной игры. Создай /game', ephemeral: true });
            return;
        }
        
        if (position > game.maxPosition) {
            await interaction.reply({ content: `❌ Максимум ${game.maxPosition}. Используй /add`, ephemeral: true });
            return;
        }
        
        if (game.players[position]) {
            await interaction.reply({ content: `❌ Позиция ${position} занята <@${game.players[position]}>`, ephemeral: true });
            return;
        }
        
        game.players[position] = interaction.user.id;
        await showGameMenu(interaction.channel);
        await interaction.reply({ content: `✅ Ты занял позицию ${position}!`, ephemeral: true });
    }
});

// Меню с кнопками и GIF снизу (БЕЗ ЛОГОТИПА СПРАВА)
async function showGameMenu(channel) {
    const game = games.get(channel.id) || { maxPosition: 10, players: {} };
    const players = game.players;
    const maxPos = game.maxPosition;
    const filled = Object.keys(players).length;
    
    const occupied = Object.keys(players).map(Number).sort((a, b) => a - b);
    
    const embed = new EmbedBuilder()
        .setTitle('🎮 БИТВА СЕМЕЙ 🎮')
        .setColor(0xFFFFFF)
        // .setThumbnail(LOGO_URL)  // <--- УБРАНО!
        .setImage(SMALL_GIF_URL)  // ТОЛЬКО GIF СНИЗУ
        .setDescription(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🏆 **ВЕТКА: #${channel.name}**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
        .addFields(
            { name: '📊 ЗАНЯТЫЕ ПОЗИЦИИ', value: occupied.length ? occupied.map(p => `**${p}.** <@${players[p]}>`).join('\n') : '⚪ Пока никого нет', inline: false },
            { name: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', value: `📊 **Занято:** ${filled} / ${maxPos}\n💡 **Нажми на кнопку** чтобы занять позицию`, inline: false }
        )
        .setFooter({ text: 'Битва Семей | Нажми на число' });
    
    const rows = [];
    let currentRow = new ActionRowBuilder();
    let count = 0;
    
    for (let i = 1; i <= maxPos && i <= 30; i++) {
        const button = new ButtonBuilder()
            .setCustomId(i.toString())
            .setLabel(i.toString())
            .setStyle(players[i] ? ButtonStyle.Danger : ButtonStyle.Success)
            .setDisabled(!!players[i]);
        
        currentRow.addComponents(button);
        count++;
        
        if (count === 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            count = 0;
        }
    }
    
    if (count > 0) rows.push(currentRow);
    
    const messages = await channel.messages.fetch({ limit: 10 });
    const botMessages = messages.filter(m => m.author.id === channel.client.user.id);
    for (const botMessage of botMessages.values()) {
        if (botMessage.embeds.length > 0 && botMessage.embeds[0].title === '🎮 БИТВА СЕМЕЙ 🎮') {
            await botMessage.delete().catch(() => {});
        }
    }
    
    await channel.send({ embeds: [embed], components: rows });
}

client.login(process.env.DISCORD_TOKEN);
