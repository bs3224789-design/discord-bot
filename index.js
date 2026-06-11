const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 👇 ВСТАВЬ СЮДА ID СВОЕГО КАНАЛА (как получить - ниже)
const BET_CHANNEL_ID = '909135900754198538'; // ЗАМЕНИ ЭТО!

const games = new Map();

client.once('ready', () => {
    console.log(`✅ Бот запущен! Имя: ${client.user.tag}`);
    console.log(`📡 Канал для ставок: ${BET_CHANNEL_ID}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== BET_CHANNEL_ID) return;

    const position = parseInt(message.content.trim());
    if (isNaN(position) || position < 1 || position > 10) return;

    await message.delete().catch(console.error);

    if (!games.has(message.channel.id)) {
        games.set(message.channel.id, {});
    }
    const currentGame = games.get(message.channel.id);

    if (currentGame[position]) {
        await message.author.send(`❌ Место ${position} уже занято игроком <@${currentGame[position]}>!`)
            .catch(() => {});
        return;
    }

    currentGame[position] = message.author.id;

    const lines = [];
    for (let i = 1; i <= 10; i++) {
        if (currentGame[i]) {
            lines.push(`**${i}.** <@${currentGame[i]}>`);
        } else {
            lines.push(`**${i}.** 🟩 Свободно`);
        }
    }

    const embed = {
        title: '🎮 Расстановка участников',
        description: lines.join('\n'),
        color: 0x00FF00,
        footer: { text: `${message.author.username} занял позицию ${position}` }
    };

    await message.channel.send({ embeds: [embed] });

    if (Object.keys(currentGame).length === 10) {
        await message.channel.send('🔔 **ВСЕ МЕСТА ЗАНЯТЫ!** Можно начинать игру! 🎲');
    }
});

client.login(process.env.DISCORD_TOKEN);
