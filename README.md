const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

const app = express();
app.use(express.json());

// --- DATABASE SIMULATION ---
let database = {
    "TUFA-FREE-KEY-2026": { hwid: null },
    "VIP-KEY-999": { hwid: null }
};

// --- KEY VERIFICATION API ---
app.post('/verify', (req, res) => {
    const { key, hwid } = req.body;

    if (!key || !hwid) {
        return res.json({ success: false, message: "Missing key or HWID." });
    }

    if (!database[key]) {
        return res.json({ success: false, message: "Invalid key." });
    }

    const keyData = database[key];

    if (keyData.hwid === null) {
        keyData.hwid = hwid;
        return res.json({ success: true, message: "Key bound & verified successfully!" });
    }

    if (keyData.hwid === hwid) {
        return res.json({ success: true, message: "Key verified!" });
    } else {
        return res.json({ success: false, message: "Key is already bound to another device!" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
});

// --- DISCORD BOT CODE ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}!`);
});

if (process.env.DISCORD_TOKEN) {
    client.login(process.env.DISCORD_TOKEN);
} else {
    console.log("Warning: DISCORD_TOKEN not found. Bot login skipped.");
}
