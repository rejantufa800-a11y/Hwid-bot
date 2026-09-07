const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs');

// --- DATABASE SIMULATION (JSON FILES) ---
const KEYS_FILE = './keys.json';
const USERS_FILE = './users.json';

function loadData(file, defaultVal) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultVal, null, 2));
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveData(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let keysDb = loadData(KEYS_FILE, {}); 
let usersDb = loadData(USERS_FILE, {}); 

// --- EXPRESS SERVER (ROBLOX BACKEND) ---
const app = express();
app.use(express.json());

app.post('/verify', (req, res) => {
    const { key, hwid } = req.body;

    if (!key || !hwid) {
        return res.json({ success: false, message: "Missing key or HWID." });
    }

    const keyData = keysDb[key];
    if (!keyData) {
        return res.json({ success: false, message: "Invalid key." });
    }

    // Check HWID locking
    if (keyData.hwid && keyData.hwid !== hwid) {
        return res.json({ success: false, message: "Key locked to another device!" });
    }

    // Bind HWID if first time use
    if (!keyData.hwid) {
        keyData.hwid = hwid;
        saveData(KEYS_FILE, keysDb);
    }

    return res.json({ success: true, message: "Access Granted!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
});

// --- DISCORD BOT ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// Helper to check admin/higher role permissions
function isAdmin(member) {
    return member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.some(r => r.name.toLowerCase().includes('owner') || r.name.toLowerCase().includes('admin'));
}

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // 1. /panel command
        if (commandName === 'panel') {
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Tufa Group Verification Panel')
                .setDescription('Click the button below to generate or check your HWID-locked key!')
                .setColor(0x00AAFF);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('open_hwid_modal')
                    .setLabel('🔑 Get / Check Key')
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.reply({ embeds: [embed], components: [row] });
        }

        // 2. /resethwid command (24h cooldown)
        else if (commandName === 'resethwid') {
            const userId = interaction.user.id;
            const now = Date.now();
            const cooldownTime = 24 * 60 * 60 * 1000; // 24 hours

            if (usersDb[userId] && usersDb[userId].lastReset && (now - usersDb[userId].lastReset < cooldownTime)) {
                const timeLeft = Math.ceil((cooldownTime - (now - usersDb[userId].lastReset)) / (1000 * 60 * 60));
                return interaction.reply({ content: `⏳ You can only reset your HWID once every 24 hours! Try again in **${timeLeft} hours**.`, ephemeral: true });
            }

            // Clear HWID from user's active key
            for (let k in keysDb) {
                if (keysDb[k].usedBy === userId) {
                    keysDb[k].hwid = null;
                }
            }

            if (!usersDb[userId]) usersDb[userId] = {};
            usersDb[userId].lastReset = now;
            saveData(USERS_FILE, usersDb);
            saveData(KEYS_FILE, keysDb);

            await interaction.reply({ content: '✅ Your HWID lock has been successfully reset! Your key can now be bound to a new device.', ephemeral: true });
        }

        // 3. /setpremium command (Admin only)
        else if (commandName === 'setpremium') {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
            }

            const targetUser = interaction.options.getUser('user');
            if (!usersDb[targetUser.id]) usersDb[targetUser.id] = {};
            usersDb[targetUser.id].premium = true;
            saveData(USERS_FILE, usersDb);

            await interaction.reply({ content: `✨ Successfully granted premium status to ${targetUser.tag}!`, ephemeral: true });
        }

        // 4. /bulkgen command (Admin only - sends file via DM)
        else if (commandName === 'bulkgen') {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
            }

            const amount = interaction.options.getInteger('amount');
            let generatedKeys = [];

            for (let i = 0; i < amount; i++) {
                const randomKey = 'TUFA-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Math.random().toString(36).substring(2, 10).toUpperCase();
                keysDb[randomKey] = { hwid: null, permanent: true, usedBy: null };
                generatedKeys.push(randomKey);
            }
            saveData(KEYS_FILE, keysDb);

            // Write to a text file
            const fileStream = './generated_keys.txt';
            fs.writeFileSync(fileStream, generatedKeys.join('\n'));

            const attachment = new AttachmentBuilder(fileStream);

            try {
                await interaction.user.send({ content: `🔑 Here are your **${amount} keys**:`, files: [attachment] });
                await interaction.reply({ content: '📭 I have sent the generated keys file directly to your DMs!', ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: '❌ Could not send you a DM. Please check your privacy settings!', ephemeral: true });
            }
        }
    } 
    
    // Modal Interaction for HWID submission
    else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'hwid_modal') {
            const hwidInput = interaction.fields.getTextInputValue('hwid_field').trim();
            const userId = interaction.user.id;

            let assignedKey = null;
            for (let k in keysDb) {
                if (keysDb[k].usedBy === userId) {
                    assignedKey = k;
                    keysDb[k].hwid = hwidInput; 
                    break;
                }
            }

            if (!assignedKey) {
                for (let k in keysDb) {
                    if (!keysDb[k].usedBy) {
                        assignedKey = k;
                        keysDb[k].usedBy = userId;
                        keysDb[k].hwid = hwidInput;
                        break;
                    }
                }
            }

            if (!assignedKey) {
                return interaction.reply({ content: '❌ No keys available right now! Please contact an administrator.', ephemeral: true });
            }

            saveData(KEYS_FILE, keysDb);

            const responseText = `Here is your key!\n\n**Mobile Copy Version:**\n\`${assignedKey}\`\n\n**PC Codeblock Version:**\n\`\`\`text\n${assignedKey}\n\`\`\``;

            await interaction.reply({ content: responseText, ephemeral: true });
        }
    }

    else if (interaction.isButton()) {
        if (interaction.customId === 'open_hwid_modal') {
            const modal = new ModalBuilder()
                .setCustomId('hwid_modal')
                .setTitle('HWID Verification');

            const hwidInput = new TextInputBuilder()
                .setCustomId('hwid_field')
                .setLabel('Paste your Roblox HWID here:')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(hwidInput));
            await interaction.showModal(modal);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
                    
