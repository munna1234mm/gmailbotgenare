import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const port = process.env.PORT || 3001;
const adminId = process.env.ADMIN_ID;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const smailproBaseUrl = "https://api.sonjj.com/v1/temp_email";

app.use(cors());
app.use(express.json());

// Serve static files from the Vite build directory
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// SmailPro API Helpers
async function getPayload(url, params = {}) {
    try {
        const query = new URLSearchParams({ url, ...params }).toString();
        const response = await axios.get(`https://smailpro.com/app/payload?${query}`);
        return response.data;
    } catch (error) {
        console.error('Payload error:', error.message);
        throw error;
    }
}

async function createSmailProEmail(email = null) {
    const payload = await getPayload(`${smailproBaseUrl}/create`, email ? { email } : {});
    const response = await axios.get(`${smailproBaseUrl}/create?payload=${payload}`);
    return response.data;
}

async function getSmailProInbox(email) {
    const payload = await getPayload(`${smailproBaseUrl}/inbox`, { email });
    const response = await axios.get(`${smailproBaseUrl}/inbox?payload=${payload}`);
    return response.data;
}

// Bot Commands
bot.start((ctx) => {
    ctx.reply('Welcome to Gmail Bot Generator! 📧\n\nI can generate edu.pl Gmails for you.\nClick the button below to generate one.', 
        Markup.keyboard([
            ['Generate edu.pl Gmail 🚀'],
            ['My Emails 📂', 'Support 💬']
        ]).resize()
    );
});

bot.hears('Generate edu.pl Gmail 🚀', async (ctx) => {
    try {
        ctx.reply('Generating your edu.pl Gmail... please wait ⏳');
        
        // In a real scenario, we might retry until we get an edu.pl domain if it's randomized
        // For now, let's assume the API provides it or we can specify it if the API allows.
        // Based on research, smailpro has dynamic domain selection.
        const emailData = await createSmailProEmail();
        
        // Save to Supabase
        const { data, error } = await supabase.from('gmail_requests').insert({
            telegram_user_id: ctx.from.id.toString(),
            email: emailData.email,
            domain: emailData.email.split('@')[1],
            status: 'pending'
        }).select().single();

        if (error) throw error;

        ctx.reply(`Generated Email: ${emailData.email}\n\nYou can now use this email. Click the button below to check for codes/OTPs.`,
            Markup.inlineKeyboard([
                [Markup.button.callback('Check OTP/Code 📩', `check_${data.id}`)]
            ])
        );
    } catch (error) {
        console.error('Bot Generate Error:', error);
        ctx.reply('Failed to generate email. Please try again later.');
    }
});

bot.action(/check_(.+)/, async (ctx) => {
    const requestId = ctx.match[1];
    
    try {
        const { data: request, error: fetchError } = await supabase
            .from('gmail_requests')
            .select('*')
            .eq('id', requestId)
            .single();

        if (fetchError || !request) return ctx.reply('Request not found.');

        ctx.answerCbQuery('Checking inbox...');
        
        const inbox = await getSmailProInbox(request.email);
        
        if (inbox && inbox.messages && inbox.messages.length > 0) {
            const lastMessage = inbox.messages[0];
            const code = lastMessage.textSubject.match(/\d{4,6}/) ? lastMessage.textSubject.match(/\d{4,6}/)[0] : 'No code found';
            
            await supabase.from('gmail_requests').update({
                otp_code: code,
                status: 'completed'
            }).eq('id', requestId);

            ctx.reply(`New message found!\n\nFrom: ${lastMessage.textFrom}\nSubject: ${lastMessage.textSubject}\n\nCode: ${code}`);
        } else {
            ctx.reply('No messages found yet. Please try again in 30 seconds.');
        }
    } catch (error) {
        console.error('Check OTP error:', error);
        ctx.reply('Error checking inbox.');
    }
});

// Admin API
app.get('/api/admin/gmails', async (req, res) => {
    const { data, error } = await supabase.from('gmail_requests').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Start Server & Bot
app.listen(port, () => {
    console.log(`Admin API listening at http://localhost:${port}`);
});

bot.launch();
console.log('Telegram Bot started!');

// Handle SPA routing: serve index.html for any unknown routes
app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
