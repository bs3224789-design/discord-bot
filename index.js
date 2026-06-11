const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const BET_CHANNEL_ID = '1514604229266767872';

// Хранилище игр по каналам
// games.get(channelId) = { maxPosition: 10, players: { 1: "id", 2: "id", ... } }
const games = new Map();

// Команды
const commands = [
    {
        name: 'game',
        description: 'Создать новую игру (по умолчанию до 10 позиций)'
    },
    {
        name: 'add',
        description: 'Добавить новые позиции (например /add 20 или /add 1-30)',
        options: [
            {
                name: 'positions',
                description: 'Номер или диапазон (например 20 или 1-30)',
                type: 3,
                required: true
            }
        ]
    },
    {
        name: 'clear',
        description: 'Очистить все позиции и начать заново'
    },
    {
        name: 'show',
        description: 'Показать текущую таблицу позиций'
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
    console.log(`📡 Канал для ставок: ${BET_CHANNEL_ID}`);
    
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
    
    if (interaction.commandName === 'game') {
        games.set(channelId, { maxPosition: 10, players: {} });
        await showPositions(interaction.channel);
        await interaction.reply({ content: '🎮 Новая игра создана! (позиции 1-10, можно расширить командой /add)', ephemeral: true });
    }
    
    if (interaction.commandName === 'add') {
        let game = games.get(channelId);
        if (!game) {
            game = { maxPosition: 10, players: {} };
            games.set(channelId, game);
        }
        
        const input = interaction.options.getString('positions');
        let newMax = 0;
        
        if (input.includes('-')) {
            const parts = input.split('-');
            newMax = parseInt(parts[1]);
        } else {
            newMax = parseInt(input);
        }
        
        if (isNaN(newMax) || newMax <= game.maxPosition) {
            await interaction.reply({ content: `❌ Нужно число больше текущего максимума (${game.maxPosition}) или диапазон вида 1-${game.maxPosition + 10}`, ephemeral: true });
            return;
        }
        
        game.maxPosition = newMax;
        await showPositions(interaction.channel);
        await interaction.reply({ content: `✅ Позиции расширены до ${newMax}!`, ephemeral: true });
    }
    
    if (interaction.commandName === 'clear') {
        const game = games.get(channelId);
        if (game) {
            game.players = {};
            await showPositions(interaction.channel);
        }
        await interaction.reply({ content: '🧹 Все позиции очищены!', ephemeral: true });
    }
    
    if (interaction.commandName === 'show') {
        await showPositions(interaction.channel);
        await interaction.reply({ content: '📊 Таблица обновлена', ephemeral: true });
    }
    
    if (interaction.commandName === 'remove') {
        const game = games.get(channelId);
        if (game) {
            const position = interaction.options.getInteger('position');
            if (game.players[position]) {
                delete game.players[position];
                await showPositions(interaction.channel);
                await interaction.reply({ content: `✅ Позиция ${position} освобождена`, ephemeral: true });
            } else {
                await interaction.reply({ content: `❌ Позиция ${position} и так свободна`, ephemeral: true });
            }
        } else {
            await interaction.reply({ content: '❌ Нет активной игры. Создай /game', ephemeral: true });
        }
    }
});

// Обработка сообщений с цифрами
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== BET_CHANNEL_ID) return;
    
    const position = parseInt(message.content.trim());
    if (isNaN(position)) return;
    
    // Удаляем сообщение игрока
    await message.delete().catch(console.error);
    
    // Получаем или создаем игру
    let game = games.get(message.channel.id);
    if (!game) {
        game = { maxPosition: 10, players: {} };
        games.set(message.channel.id, game);
    }
    
    // Если позиция больше максимума - автоматически расширяем
    if (position > game.maxPosition) {
        game.maxPosition = position;
        await message.channel.send(`📈 **Автоматическое расширение!** Максимум увеличен до ${position}`);
    }
    
    // Проверяем, свободно ли место
    if (game.players[position]) {
        await message.author.send(`❌ Позиция **${position}** уже занята игроком <@${game.players[position]}>!`)
            .catch(() => console.log('Не удалось отправить ЛС'));
        return;
    }
    
    // Ставим игрока на позицию
    game.players[position] = message.author.id;
    
    // Показываем обновленную таблицу
    await showPositions(message.channel);
});

// Функция для отображения позиций
async function showPositions(channel) {
    const game = games.get(channel.id) || { maxPosition: 10, players: {} };
    const players = game.players;
    const maxPos = game.maxPosition;
    
    const filled = Object.keys(players).length;
    
    // Находим занятые позиции и сортируем
    const occupiedPositions = Object.keys(players).map(Number).sort((a, b) => a - b);
    
    // Показываем только занятые позиции + сколько всего свободно
    const lines = [];
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('🏆 **БИТВА СЕМЕЙ** 🏆');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
    
    for (const pos of occupiedPositions) {
        lines.push(`**${pos}.** 🟢 <@${players[pos]}>`);
    }
    
    if (occupiedPositions.length === 0) {
        lines.push('⚪ Пока никого нет');
    }
    
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`📊 **Занято:** ${filled} / ${maxPos}`);
    lines.push(`📈 **Диапазон:** 1-${maxPos} (расширяется автоматически)`);
    lines.push('');
    lines.push('💡 **Как играть:**');
    lines.push('• Напиши число чтобы занять позицию');
    lines.push('• Если числа нет в таблице — оно добавится');
    lines.push('• Команды: `/add 50` расширить, `/clear` очистить');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const embed = {
        title: '🎮 ТАБЛИЦА ПОЗИЦИЙ',
        description: lines.join('\n'),
        color: 0x00FF00,
        footer: { text: 'Сообщения автоматически удаляются 🤫' }
    };
    
    // Удаляем старое сообщение бота
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
