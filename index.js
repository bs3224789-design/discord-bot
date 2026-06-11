const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Хранилище игр по каналам (канал = своя ветка)
const games = new Map();

// Команды
const commands = [
    {
        name: 'game',
        description: 'Создать новую игру в этой ветке (очищает позиции)'
    },
    {
        name: 'add',
        description: 'Добавить новые позиции (например /add 20)',
        options: [
            {
                name: 'positions',
                description: 'Число (например 20)',
                type: 3,
                required: true
            }
        ]
    },
    {
        name: 'clear',
        description: 'Очистить все позиции в этой ветке'
    },
    {
        name: 'show',
        description: 'Показать текущую таблицу'
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
    if (!interaction.isCommand()) return;
    
    const channelId = interaction.channel.id;
    
    // /game - создает новую игру в этой ветке (канале)
    if (interaction.commandName === 'game') {
        games.set(channelId, { maxPosition: 10, players: {} });
        await showPositions(interaction.channel);
        await interaction.reply({ 
            content: '🎮 **Новая игра создана в этой ветке!**\nПишите числа чтобы занять позиции.', 
            ephemeral: true 
        });
        return;
    }
    
    // /add - расширить позиции
    if (interaction.commandName === 'add') {
        let game = games.get(channelId);
        if (!game) {
            game = { maxPosition: 10, players: {} };
            games.set(channelId, game);
        }
        
        const input = interaction.options.getString('positions');
        let newMax = parseInt(input);
        
        if (isNaN(newMax) || newMax <= game.maxPosition) {
            await interaction.reply({ 
                content: `❌ Нужно число больше ${game.maxPosition}`, 
                ephemeral: true 
            });
            return;
        }
        
        game.maxPosition = newMax;
        await showPositions(interaction.channel);
        await interaction.reply({ 
            content: `✅ Позиции расширены до ${newMax}!`, 
            ephemeral: true 
        });
        return;
    }
    
    // /clear - очистить позиции
    if (interaction.commandName === 'clear') {
        const game = games.get(channelId);
        if (game) {
            game.players = {};
            await showPositions(interaction.channel);
        }
        await interaction.reply({ 
            content: '🧹 Все позиции очищены!', 
            ephemeral: true 
        });
        return;
    }
    
    // /show - показать таблицу
    if (interaction.commandName === 'show') {
        await showPositions(interaction.channel);
        await interaction.reply({ 
            content: '📊 Таблица обновлена', 
            ephemeral: true 
        });
        return;
    }
    
    // /remove - убрать игрока
    if (interaction.commandName === 'remove') {
        const game = games.get(channelId);
        if (game) {
            const position = interaction.options.getInteger('position');
            if (game.players[position]) {
                delete game.players[position];
                await showPositions(interaction.channel);
                await interaction.reply({ 
                    content: `✅ Позиция ${position} освобождена`, 
                    ephemeral: true 
                });
            } else {
                await interaction.reply({ 
                    content: `❌ Позиция ${position} свободна`, 
                    ephemeral: true 
                });
            }
        } else {
            await interaction.reply({ 
                content: '❌ Нет игры. Создай /game', 
                ephemeral: true 
            });
        }
        return;
    }
});

// Обработка сообщений с цифрами
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const position = parseInt(message.content.trim());
    if (isNaN(position)) return;
    
    // Получаем или создаем игру для ЭТОГО канала (ветки)
    let game = games.get(message.channel.id);
    if (!game) {
        game = { maxPosition: 10, players: {} };
        games.set(message.channel.id, game);
    }
    
    // Удаляем сообщение игрока
    await message.delete().catch(console.error);
    
    // Автоматическое расширение
    if (position > game.maxPosition) {
        game.maxPosition = position;
        await message.channel.send(`📈 **Расширение до ${position}!**`);
    }
    
    // Проверка занято
    if (game.players[position]) {
        await message.author.send(`❌ Позиция ${position} занята <@${game.players[position]}>`)
            .catch(() => {});
        return;
    }
    
    // Занимаем позицию
    game.players[position] = message.author.id;
    await showPositions(message.channel);
});

// Показать таблицу
async function showPositions(channel) {
    const game = games.get(channel.id) || { maxPosition: 10, players: {} };
    const players = game.players;
    const maxPos = game.maxPosition;
    const filled = Object.keys(players).length;
    
    const occupied = Object.keys(players).map(Number).sort((a, b) => a - b);
    
    const lines = [];
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`🏆 **ВЕТКА: #${channel.name}** 🏆`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
    
    for (const pos of occupied) {
        lines.push(`**${pos}.** 🟢 <@${players[pos]}>`);
    }
    
    if (occupied.length === 0) {
        lines.push('⚪ Пока никого нет');
    }
    
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`📊 **Занято:** ${filled} / ${maxPos}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('💡 **Пиши число** чтобы занять позицию');
    lines.push('📌 `/game` - новая игра в этой ветке');
    lines.push('📌 `/add 50` - расширить');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const embed = {
        title: '🎮 ТАБЛИЦА ПОЗИЦИЙ',
        description: lines.join('\n'),
        color: 0x00FF00
    };
    
    // Удаляем старое сообщение
    const messages = await channel.messages.fetch({ limit: 10 });
    const botMessages = messages.filter(m => m.author.id === channel.client.user.id);
    for (const botMessage of botMessages.values()) {
        if (botMessage.embeds.length > 0 && botMessage.embeds[0].title === '🎮 ТАБЛИЦА ПОЗИЦИЙ') {
            await botMessage.delete().catch(() => {});
        }
    }
    
    await channel.send({ embeds: [embed] });
}

client.login(process.env.DISCORD_TOKEN);
