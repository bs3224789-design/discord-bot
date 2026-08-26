const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ===== Хранилище игр (в памяти) =====
const games = new Map();

// ТОЛЬКО АНИМИРОВАННЫЙ GIF (снизу) - ЛОГОТИП УБРАН
const SMALL_GIF_URL = 'https://i.imgur.com/5Y7EpmD.gif';

// ===== Роли "хай-ранга", которым разрешена команда /invite =====
const HIGH_RANK_ROLE_IDS = [
    '1514614732089331772',
    '1514599381230293094',
    '1514710792677884125',
    '1514601261612400781',
    '1514613884189802597'
];

// Discord позволяет максимум 5 ActionRow x 5 кнопок = 25 кнопок в сообщении
const MAX_BUTTONS = 25;

// ===== Глобальные обработчики, чтобы бот не падал целиком =====
process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

// ===== Команды =====
const commands = [
    {
        name: 'game',
        description: 'Создать новую игру в ветке (сам посчитает по реакциям на последнем сообщении в канале)'
    },
    {
        name: 'add',
        description: 'Добавить позиции',
        options: [
            {
                name: 'positions',
                description: 'Количество позиций (максимум 25)',
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
    },
    {
        name: 'invite',
        description: 'Добавить пользователя в этот приватный канал/ветку (только хай-ранг)',
        options: [
            {
                name: 'user',
                description: 'Кого добавить',
                type: 6,
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
        console.error('❌ Ошибка регистрации команд:', error);
    }
});

client.on('error', (err) => console.error('❌ Client error:', err));

// ===================================================================
// Проверка "хай-ранга" — работает и с закешированным GuildMember,
// и с "сырыми" данными интеракции (roles как массив id).
// ===================================================================
function hasHighRank(member) {
    if (!member || !member.roles) return false;
    const roles = member.roles;
    if (roles.cache) {
        return HIGH_RANK_ROLE_IDS.some((id) => roles.cache.has(id));
    }
    if (Array.isArray(roles)) {
        return HIGH_RANK_ROLE_IDS.some((id) => roles.includes(id));
    }
    return false;
}

async function replySafe(interaction, payload) {
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply(payload);
        }
    } catch (err) {
        console.error('❌ Не удалось ответить на интеракцию:', err);
    }
}

// ===================================================================
// Слеш-команды
// ===================================================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    try {
        const channelId = interaction.channel?.id;

        if (interaction.commandName === 'game') {
            if (!interaction.channel || interaction.channel.isThread()) {
                await interaction.reply({
                    content: '❌ Создавать игру нужно в обычном канале, а не внутри ветки.',
                    ephemeral: true
                });
                return;
            }

            await interaction.deferReply({ ephemeral: true });

            try {
                // /game больше не принимает параметров. Ищем САМОЕ СВЕЖЕЕ
                // сообщение с реакциями в этом канале (не важно, кто его
                // написал) и считаем позиции по числу реагировавших. Если
                // такого сообщения нет — используем 10 по умолчанию.
                let maxPos = 10;

                const recentMessages = await interaction.channel.messages.fetch({ limit: 50 });
                const sourceMessage = recentMessages.find(
                    (m) => !m.author.bot && m.reactions.cache.size > 0
                );

                if (sourceMessage) {
                    const reactorIds = new Set();
                    for (const reaction of sourceMessage.reactions.cache.values()) {
                        try {
                            const users = await reaction.users.fetch();
                            users.forEach((u) => {
                                if (!u.bot) reactorIds.add(u.id);
                            });
                        } catch (err) {
                            console.error('⚠️ Не удалось получить пользователей реакции:', err);
                        }
                    }

                    if (reactorIds.size > 0) {
                        maxPos = reactorIds.size;
                    }
                }

                if (maxPos < 1) {
                    await interaction.editReply({ content: '❌ Количество позиций должно быть больше 0.' });
                    return;
                }
                if (maxPos > MAX_BUTTONS) {
                    maxPos = MAX_BUTTONS;
                }

                const threadName = `🎮 Игра на ${maxPos} мест`;

                // Берём АКТУАЛЬНЫЙ список активных веток через API, а не
                // устаревший кэш — иначе можно "воскресить" уже
                // заархивированную ветку и получить ложный успех.
                const active = await interaction.channel.threads.fetchActive();
                let targetThread = active.threads.find((t) => t.name === threadName);

                if (!targetThread) {
                    targetThread = await interaction.channel.threads.create({
                        name: threadName,
                        autoArchiveDuration: 60,
                        type: ChannelType.PublicThread,
                        reason: 'Новая игра Битва Семей'
                    });

                    await targetThread.send(
                        `🎮 **Добро пожаловать в игру!**\n📊 **${maxPos}** позиций доступно.\n💡 Нажимай на кнопки чтобы занять место!`
                    );
                } else if (targetThread.archived) {
                    await targetThread.setArchived(false).catch(() => {});
                }

                let game = games.get(targetThread.id);
                if (!game) {
                    game = { maxPosition: maxPos, players: {} };
                    games.set(targetThread.id, game);
                } else if (maxPos > game.maxPosition) {
                    game.maxPosition = maxPos;
                }

                await showGameMenu(targetThread);

                await interaction.editReply({
                    content: `✅ Готово! Ветка **${threadName}**: <#${targetThread.id}>`
                });
            } catch (error) {
                console.error('❌ Ошибка создания игры:', error);
                await replySafe(interaction, {
                    content: '❌ Не удалось создать ветку. Проверь права бота (Manage Threads / Manage Channels).'
                });
            }
            return;
        }

        if (interaction.commandName === 'add') {
            if (!interaction.channel) {
                await interaction.reply({ content: '❌ Не удалось определить канал.', ephemeral: true });
                return;
            }

            let game = games.get(channelId);
            if (!game) game = { maxPosition: 10, players: {} };

            let newMax = interaction.options.getInteger('positions');

            if (newMax > MAX_BUTTONS) newMax = MAX_BUTTONS;

            if (newMax > game.maxPosition) {
                game.maxPosition = newMax;
                games.set(channelId, game);

                await interaction.deferReply({ ephemeral: true });
                await showGameMenu(interaction.channel);
                await interaction.editReply({ content: `✅ Расширено до ${newMax} позиций!` });
            } else {
                await interaction.reply({ content: `❌ Число должно быть больше ${game.maxPosition}`, ephemeral: true });
            }
            return;
        }

        if (interaction.commandName === 'clear') {
            if (!interaction.channel) {
                await interaction.reply({ content: '❌ Не удалось определить канал.', ephemeral: true });
                return;
            }

            const game = games.get(channelId);
            if (game) game.players = {};

            await interaction.deferReply({ ephemeral: true });
            await showGameMenu(interaction.channel);
            await interaction.editReply({ content: '🧹 Все очищено!' });
            return;
        }

        if (interaction.commandName === 'show') {
            if (!interaction.channel) {
                await interaction.reply({ content: '❌ Не удалось определить канал.', ephemeral: true });
                return;
            }

            await interaction.deferReply({ ephemeral: true });
            await showGameMenu(interaction.channel);
            await interaction.editReply({ content: '📊 Обновлено' });
            return;
        }

        if (interaction.commandName === 'remove') {
            const game = games.get(channelId);
            const pos = interaction.options.getInteger('position');

            if (!game) {
                await interaction.reply({ content: '❌ Нет активной игры в этом канале/ветке.', ephemeral: true });
                return;
            }

            if (game.players[pos]) {
                delete game.players[pos];
                await interaction.deferReply({ ephemeral: true });
                await showGameMenu(interaction.channel);
                await interaction.editReply({ content: `✅ Позиция ${pos} свободна` });
            } else {
                await interaction.reply({ content: `❌ Позиция ${pos} уже свободна`, ephemeral: true });
            }
            return;
        }

        if (interaction.commandName === 'invite') {
            if (!hasHighRank(interaction.member)) {
                await interaction.reply({ content: '❌ У тебя нет прав для этой команды.', ephemeral: true });
                return;
            }

            const targetUser = interaction.options.getUser('user');
            const channel = interaction.channel;

            if (!channel) {
                await interaction.reply({ content: '❌ Не удалось определить канал.', ephemeral: true });
                return;
            }

            await interaction.deferReply({ ephemeral: true });

            try {
                if (channel.isThread()) {
                    await channel.members.add(targetUser.id);
                } else {
                    await channel.permissionOverwrites.edit(targetUser.id, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true
                    });
                }

                await channel.send(`✅ <@${targetUser.id}> добавлен(а) сюда пользователем <@${interaction.user.id}>`).catch(() => {});
                await interaction.editReply({ content: `✅ ${targetUser} добавлен(а) в этот канал/ветку.` });
            } catch (err) {
                console.error('❌ Ошибка /invite:', err);
                await interaction.editReply({
                    content: '❌ Не удалось добавить пользователя. Проверь права бота (Manage Roles / Manage Threads).'
                });
            }
            return;
        }
    } catch (error) {
        console.error('❌ Ошибка обработки команды:', error);
        await replySafe(interaction, { content: '❌ Произошла ошибка при выполнении команды.' });
    }
});

// ===================================================================
// Кнопки игры
// ===================================================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    try {
        const position = parseInt(interaction.customId, 10);
        if (isNaN(position)) return;

        if (!interaction.channel) {
            await interaction.reply({ content: '❌ Не удалось определить канал.', ephemeral: true });
            return;
        }

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
            await interaction.reply({
                content: `❌ Позиция ${position} занята <@${game.players[position]}>`,
                ephemeral: true
            });
            return;
        }

        game.players[position] = interaction.user.id;

        await interaction.deferReply({ ephemeral: true });
        await showGameMenu(interaction.channel);
        await interaction.editReply({ content: `✅ Ты занял позицию ${position}!` });
    } catch (error) {
        console.error('❌ Ошибка обработки кнопки:', error);
        await replySafe(interaction, { content: '❌ Произошла ошибка.' });
    }
});

// ===================================================================
// Меню с кнопками и GIF снизу
// ===================================================================
async function showGameMenu(channel) {
    try {
        const game = games.get(channel.id) || { maxPosition: 10, players: {} };
        const players = game.players;
        const maxPos = Math.min(game.maxPosition, MAX_BUTTONS);
        const filled = Object.keys(players).length;

        const occupied = Object.keys(players).map(Number).sort((a, b) => a - b);

        const embed = new EmbedBuilder()
            .setTitle('🎮 БИТВА СЕМЕЙ 🎮')
            .setColor(0xffffff)
            .setImage(SMALL_GIF_URL)
            .setDescription(
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🏆 **ВЕТКА: #${channel.name}**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
            )
            .addFields(
                {
                    name: '📊 ЗАНЯТЫЕ ПОЗИЦИИ',
                    value: occupied.length
                        ? occupied.map((p) => `**${p}.** <@${players[p]}>`).join('\n')
                        : '⚪ Пока никого нет',
                    inline: false
                },
                {
                    name: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                    value: `📊 **Занято:** ${filled} / ${maxPos}\n💡 **Нажми на кнопку** чтобы занять позицию`,
                    inline: false
                }
            )
            .setFooter({ text: 'Битва Семей | Нажми на число' });

        const rows = [];
        let currentRow = new ActionRowBuilder();
        let count = 0;

        for (let i = 1; i <= maxPos; i++) {
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

        try {
            const messages = await channel.messages.fetch({ limit: 10 });
            const botMessages = messages.filter((m) => m.author.id === channel.client.user.id);
            for (const botMessage of botMessages.values()) {
                if (botMessage.embeds.length > 0 && botMessage.embeds[0].title === '🎮 БИТВА СЕМЕЙ 🎮') {
                    await botMessage.delete().catch(() => {});
                }
            }
        } catch (err) {
            console.error('⚠️ Не удалось очистить старые сообщения меню:', err);
        }

        await channel.send({ embeds: [embed], components: rows });
    } catch (error) {
        console.error('❌ Ошибка отрисовки меню игры:', error);
    }
}

// ===================================================================
// Авто-создание приватной ВЕТКИ по реакциям + игра внутри неё
//
// Как это работает: пользователь пишет сообщение, люди ставят на него
// реакции (любой эмодзи). Когда автор исходного сообщения отвечает на
// него обычным Reply в Discord, бот собирает всех, кто поставил
// реакцию, и создаёт ПРИВАТНУЮ ВЕТКУ, которую видят только они
// (+ автор). Внутри сразу разворачивается игра с кнопками-позициями —
// по числу людей, поставивших реакцию. Если отвечает не автор
// исходного сообщения — ничего не происходит (защита от случайных
// срабатываний на чужих сообщениях).
// ===================================================================
client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;
        if (!message.guild) return;
        if (!message.reference || !message.reference.messageId) return;

        const channel = message.channel;
        if (channel.isThread()) return; // ветку внутри ветки не создаём

        let original;
        try {
            original = await channel.messages.fetch(message.reference.messageId);
        } catch (err) {
            return; // сообщение недоступно/удалено
        }

        if (!original) return;
        if (original.author.id !== message.author.id) return; // отвечать может только автор исходного сообщения
        if (!original.reactions || original.reactions.cache.size === 0) return;

        // Собираем всех уникальных пользователей, поставивших любую реакцию
        const collectedUsers = new Map();
        for (const reaction of original.reactions.cache.values()) {
            try {
                const users = await reaction.users.fetch();
                users.forEach((u) => {
                    if (!u.bot) collectedUsers.set(u.id, u);
                });
            } catch (err) {
                console.error('⚠️ Не удалось получить пользователей реакции:', err);
            }
        }

        if (collectedUsers.size === 0) {
            await message.reply({ content: 'ℹ️ Пока никто не поставил реакцию на это сообщение.' }).catch(() => {});
            return;
        }

        if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageThreads)) {
            await message
                .reply({ content: '❌ У бота нет права Manage Threads — не могу создать приватную ветку.' })
                .catch(() => {});
            return;
        }

        const maxPos = Math.min(collectedUsers.size, MAX_BUTTONS);
        const safeAuthorName = message.author.username.slice(0, 40);
        const threadName = `🔒 Игра на ${maxPos} мест (${safeAuthorName})`;

        let targetThread;
        try {
            targetThread = await channel.threads.create({
                name: threadName,
                type: ChannelType.PrivateThread,
                autoArchiveDuration: 60,
                invitable: false,
                reason: `Приватная ветка по реакциям на сообщение ${original.id} (${message.author.tag})`
            });
        } catch (err) {
            console.error('⚠️ Не удалось создать приватную ветку, пробую приватный канал как фоллбэк:', err);

            // Фоллбэк: если приватные ветки недоступны на этом сервере —
            // создаём обычный приватный канал с ручными правами доступа.
            let parentCategoryId = null;
            try {
                parentCategoryId = channel.parentId ?? null;
            } catch {
                parentCategoryId = null;
            }

            const safeChannelName = message.author.username
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '-')
                .replace(/-+/g, '-')
                .slice(0, 60);

            const permissionOverwrites = [
                { id: message.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                {
                    id: client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageRoles
                    ]
                },
                {
                    id: message.author.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                },
                ...[...collectedUsers.values()].map((u) => ({
                    id: u.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                }))
            ];

            targetThread = await message.guild.channels.create({
                name: `secret-${safeChannelName || 'chat'}-${Date.now().toString(36).slice(-4)}`,
                type: ChannelType.GuildText,
                parent: parentCategoryId || undefined,
                permissionOverwrites,
                reason: `Приватный канал (фоллбэк) по реакциям на сообщение ${original.id}`
            });
        }

        // Добавляем в ветку автора и всех, кто поставил реакцию
        // (для приватного канала-фоллбэка это не нужно — доступ уже
        // выдан через permissionOverwrites выше).
        if (targetThread.isThread()) {
            try {
                await targetThread.members.add(message.author.id);
            } catch (err) {
                console.error('⚠️ Не удалось добавить автора в ветку:', err);
            }
            for (const userId of collectedUsers.keys()) {
                try {
                    await targetThread.members.add(userId);
                } catch (err) {
                    console.error(`⚠️ Не удалось добавить пользователя ${userId} в ветку:`, err);
                }
            }
        }

        games.set(targetThread.id, { maxPosition: maxPos, players: {} });

        const mentions = [...collectedUsers.values()].map((u) => `<@${u.id}>`).join(', ');
        await targetThread
            .send(
                `👋 ${message.author}, это приватная ветка только для тех, кто поставил реакцию на твоё сообщение.\n👥 Участники: ${mentions}`
            )
            .catch(() => {});

        await showGameMenu(targetThread);

        await message.reply({ content: `✅ Создана приватная ветка: ${targetThread}` }).catch(() => {});
    } catch (error) {
        console.error('❌ Ошибка создания приватной ветки по реакциям:', error);
    }
});

client.login(process.env.DISCORD_TOKEN);
