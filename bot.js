cat << 'EOF' > setup_wintuneling.sh
#!/bin/bash

# Warna
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}[+] Memulai Instalasi WINTUNELING BOT...${NC}"

# 1. Install Node.js & PM2
if ! command -v node &> /dev/null; then
    echo "[-] Node.js tidak ditemukan, menginstall..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "[+] Node.js sudah terinstall"
fi

if ! command -v pm2 &> /dev/null; then
    echo "[-] PM2 tidak ditemukan, menginstall..."
    npm install -g pm2
fi

# 2. Buat Folder Project
mkdir -p wintuneling-bot
cd wintuneling-bot

# 3. Input Data Konfigurasi
echo -e "\n${GREEN}[!] MASUKKAN DATA KONFIGURASI BOT:${NC}"
read -p "1. Masukkan BOT TOKEN (dari BotFather): " IN_TOKEN
read -p "2. Masukkan ID ADMIN (Angka): " IN_ADMIN
read -p "3. Masukkan ID CHANNEL (awalan -100): " IN_CHANNEL
read -p "4. Masukkan Username OrderKuota: " IN_OK_USER
read -p "5. Masukkan Token/API Key OrderKuota: " IN_OK_TOKEN
read -p "6. Masukkan String QRIS : " IN_QRIS
echo "------------------------------------------------"

# 4. Buat file config.js
echo "[+] Membuat file konfigurasi..."
cat <<EOCONF > config.js
module.exports = {
    BOT_TOKEN: '$IN_TOKEN',
    ADMIN_ID: $IN_ADMIN,
    CHANNEL_ID: '$IN_CHANNEL',
    OK_USERNAME: '$IN_OK_USER',
    OK_TOKEN: '$IN_OK_TOKEN',
    QRIS_STATIC_STRING: '$IN_QRIS',
    PAYMENT_API_KEY: 'AriApiPaymetGetwayMod'
};
EOCONF

# 5. Buat file bot.js (Core Code)
echo "[+] Menulis kode bot..."
cat << 'EOBOT' > bot.js
/* WINTUNELING FINAL BOT */
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const qs = require('qs');
const CONFIG = require('./config.js'); // Load config

const bot = new Telegraf(CONFIG.BOT_TOKEN);
const db = new sqlite3.Database('wintuneling.db');
const globalState = {}; 
global.pendingTrx = {}; 

// --- DATABASE ---
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, saldo INTEGER DEFAULT 0, name TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT, category TEXT, price_buy INTEGER, price_sell INTEGER)");
});

const formatRp = (angka) => 'Rp ' + parseInt(angka).toLocaleString('id-ID');
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

// --- ADMIN PANEL ---
bot.command('admin', (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    ctx.reply('🔧 <b>ADMIN PANEL</b>', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[Markup.button.callback('➕ Tambah Produk', 'adm_add')]] } });
});

bot.action('adm_add', (ctx) => {
    globalState[ctx.from.id] = { step: 'INPUT_CODE' };
    ctx.reply('➡️ Masukkan KODE PRODUK (API):');
});

bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = globalState[userId];
    const text = ctx.message.text;

    // Logic Admin
    if (state && userId === CONFIG.ADMIN_ID && state.step) {
        if (state.step === 'INPUT_CODE') { state.code = text; state.step = 'INPUT_NAME'; return ctx.reply('➡️ Nama Tampilan:'); }
        if (state.step === 'INPUT_NAME') { state.name = text; state.step = 'INPUT_CAT'; return ctx.reply('➡️ Kategori (XL/INDOSAT):'); }
        if (state.step === 'INPUT_CAT') { state.category = text.toUpperCase(); state.step = 'INPUT_BUY'; return ctx.reply('➡️ Harga Beli:'); }
        if (state.step === 'INPUT_BUY') { state.price_buy = parseInt(text); state.step = 'INPUT_SELL'; return ctx.reply('➡️ Harga Jual:'); }
        if (state.step === 'INPUT_SELL') {
            db.run("INSERT INTO products (code, name, category, price_buy, price_sell) VALUES (?,?,?,?,?)", [state.code, state.name, state.category, state.price_buy, parseInt(text)]);
            ctx.reply('✅ Produk Disimpan!'); delete globalState[userId]; return;
        }
    }
    // Logic User Input Nomor
    if (state && state.mode === 'INPUT_NUMBER') {
        const target = text.replace(/[^0-9]/g, '');
        if (target.length < 9) return ctx.reply('⚠️ Nomor tidak valid.');
        const prod = state.product;
        
        ctx.reply(`🧾 <b>KONFIRMASI</b>\n📦 ${prod.name}\n📱 ${target}\n💸 ${formatRp(prod.price_sell)}`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
                [Markup.button.callback(`💳 Saldo`, `pay_saldo_${prod.id}_${target}`)],
                [Markup.button.callback(`⚡ QRIS`, `pay_qris_${prod.id}_${target}`)],
                [Markup.button.callback('❌ Batal', 'back_home')]
            ]}
        });
        delete globalState[userId]; return;
    }
    next();
});

// --- MENU & FLOW ---
bot.start((ctx) => {
    db.get("SELECT * FROM users WHERE user_id = ?", [ctx.from.id], (err, row) => {
        if (!row) db.run("INSERT INTO users (user_id, name) VALUES (?,?)", [ctx.from.id, ctx.from.first_name]);
        const saldo = row ? row.saldo : 0;
        ctx.reply(`🔥 <b>WINTUNELING STORE</b>\n👋 Halo ${ctx.from.first_name}\n💰 Saldo: <b>${formatRp(saldo)}</b>\n\nPilih menu:`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
                [Markup.button.callback('🛒 Beli Kuota', 'menu_beli'), Markup.button.callback('💳 Isi Saldo', 'topup_saldo')],
                [Markup.button.callback('📚 Panduan', 'panduan'), Markup.button.callback('ℹ️ Info', 'info_bot')]
            ]}
        });
    });
});

bot.action('back_home', (ctx) => { ctx.deleteMessage().catch(()=>{}); ctx.telegram.sendCopy(ctx.chat.id, {text: '/start untuk menu'}); });

bot.action('menu_beli', (ctx) => {
    ctx.editMessageText('📡 <b>PILIH PROVIDER</b>', { parse_mode:'HTML', reply_markup: { inline_keyboard: [[Markup.button.callback('🔵 XL', 'list_XL'), Markup.button.callback('🟡 Indosat', 'list_INDOSAT')], [Markup.button.callback('🏠 Home', 'back_home')]] } }).catch(()=>{});
});

bot.action(/list_(.+)/, (ctx) => {
    const cat = ctx.match[1];
    db.all("SELECT * FROM products WHERE category = ?", [cat], (err, rows) => {
        if (!rows || !rows.length) return ctx.answerCbQuery('Kosong', {show_alert:true});
        const buttons = []; let temp = [];
        rows.forEach(p => { temp.push(Markup.button.callback(`${p.name} • ${p.price_sell/1000}k`, `buy_prod_${p.id}`)); if(temp.length===2){buttons.push(temp); temp=[];} });
        if(temp.length) buttons.push(temp);
        buttons.push([Markup.button.callback('🔙 Kembali', 'menu_beli')]);
        ctx.editMessageText(`📦 <b>${cat}</b>`, {parse_mode:'HTML', reply_markup: {inline_keyboard: buttons}}).catch(()=>{});
    });
});

bot.action(/buy_prod_(\d+)/, (ctx) => {
    db.get("SELECT * FROM products WHERE id=?", [ctx.match[1]], (err, row) => {
        globalState[ctx.from.id] = { mode: 'INPUT_NUMBER', product: row };
        ctx.editMessageText(`📝 Input Nomor HP untuk <b>${row.name}</b>:`, {parse_mode:'HTML'});
    });
});

// --- TRANSAKSI ---
bot.action(/pay_saldo_(\d+)_(.+)/, (ctx) => {
    const [_, pid, target] = ctx.match;
    const uid = ctx.from.id;
    db.get("SELECT saldo FROM users WHERE user_id=?", [uid], (e, u) => {
        db.get("SELECT * FROM products WHERE id=?", [pid], (e, p) => {
            if(u.saldo < p.price_sell) return ctx.answerCbQuery('Saldo Kurang!', {show_alert:true});
            db.run("UPDATE users SET saldo = saldo - ? WHERE user_id=?", [p.price_sell, uid]);
            ctx.deleteMessage().catch(()=>{});
            processOrder(uid, p, target, 'SALDO', p.price_sell);
        });
    });
});

bot.action(/pay_qris_(\d+)_(.+)/, (ctx) => {
    db.get("SELECT * FROM products WHERE id=?", [ctx.match[1]], (e, p) => createQRIS(ctx, p.price_sell, 'PURCHASE', {prod:p, target:ctx.match[2]}));
});

bot.action('topup_saldo', (ctx) => {
    ctx.editMessageText('💰 Pilih Nominal:', {reply_markup:{inline_keyboard:[[Markup.button.callback('10rb','depo_10000'),Markup.button.callback('25rb','depo_25000')],[Markup.button.callback('50rb','depo_50000'),Markup.button.callback('🏠 Batal','back_home')]]}});
});
bot.action(/depo_(\d+)/, (ctx) => createQRIS(ctx, parseInt(ctx.match[1]), 'DEPOSIT', {}));

async function createQRIS(ctx, amount, type, data) {
    const finalAmount = amount + rand(1, 150);
    const uniqueCode = `trx-${ctx.from.id}-${Date.now()}`;
    try {
        ctx.reply('⏳ Membuat QRIS...');
        const res = await axios.get(`https://api.rajaserverpremium.web.id/orderkuota/createpayment`, {
            params: { apikey: CONFIG.PAYMENT_API_KEY, amount: finalAmount, codeqr: CONFIG.QRIS_STATIC_STRING }
        });
        if(res.data.status !== 'success') throw new Error();
        
        const msg = await ctx.replyWithPhoto(res.data.result.imageqris.url, {
            caption: `📥 <b>TOTAL: ${formatRp(finalAmount)}</b>\nBayar sesuai nominal (3 digit terakhir).\nOtomatis cek 2 menit.`, parse_mode:'HTML'
        });
        global.pendingTrx[uniqueCode] = { uniqueCode, userId: ctx.from.id, amount: finalAmount, type, data, timestamp: Date.now(), msgId: msg.message_id };
    } catch(e) { ctx.reply('❌ Gagal QRIS'); }
}

async function processOrder(uid, prod, target, method, amount) {
    bot.telegram.sendMessage(uid, '⏳ Memproses...');
    const url = prod.category === 'XL' ? 'https://cybersolution.my.id/api/order-xl' : 'https://cybersolution.my.id/api/order-indosat';
    try {
        const payload = { auth_token: CONFIG.OK_TOKEN.split(':')[1] || CONFIG.OK_TOKEN, auth_username: CONFIG.OK_USERNAME, target_number: target, voucher_id: prod.code };
        const res = await axios.post(url, payload);
        if(res.data.success || res.data.status === 'Sukses') {
            bot.telegram.sendMessage(uid, `✅ <b>SUKSES!</b>\n${prod.name}\nSN: ${res.data.transaction_details?.sn}`, {parse_mode:'HTML'});
            bot.telegram.sendMessage(CONFIG.CHANNEL_ID, `🔔 <b>ORDER DONE</b>\nUser: ${uid}\nItem: ${prod.name}\nProfit: ${formatRp(prod.price_sell - prod.price_buy)}`, {parse_mode:'HTML'});
        } else throw new Error(res.data.message);
    } catch(e) {
        bot.telegram.sendMessage(uid, `❌ GAGAL: ${e.message}\nDana dikembalikan.`);
        db.run("UPDATE users SET saldo = saldo + ? WHERE user_id=?", [amount, uid]);
    }
}

async function checkMutation() {
    if(!Object.keys(global.pendingTrx).length) return;
    try {
        const res = await axios.post('https://orkutapi.andyyuda41.workers.dev/api/qris-history', qs.stringify({username:CONFIG.OK_USERNAME, token:CONFIG.OK_TOKEN, jenis:'masuk'}), {headers:{'Content-Type':'application/x-www-form-urlencoded'}});
        const text = typeof res.data==='string'?res.data:JSON.stringify(res.data);
        const incoming = [];
        text.split('------------------------').forEach(b => {
             const m = b.match(/Kredit\s*:\s*(?:Rp\s*)?([\d.]+)/i);
             if(m) incoming.push(parseInt(m[1].replace(/\./g, '')));
        });

        for(const [code, trx] of Object.entries(global.pendingTrx)) {
            if(Date.now() - trx.timestamp > 600000) { delete global.pendingTrx[code]; continue; }
            if(incoming.includes(trx.amount)) {
                bot.telegram.deleteMessage(trx.userId, trx.msgId).catch(()=>{});
                delete global.pendingTrx[code];
                if(trx.type === 'DEPOSIT') {
                    db.run("UPDATE users SET saldo = saldo + ? WHERE user_id=?", [trx.amount, trx.userId]);
                    bot.telegram.sendMessage(trx.userId, `✅ Deposit Masuk: ${formatRp(trx.amount)}`);
                } else processOrder(trx.userId, trx.data.prod, trx.data.target, 'QRIS', trx.amount);
            }
        }
    } catch(e) {}
}
setInterval(checkMutation, 10000);

bot.action('panduan', (ctx) => ctx.editMessageText('📚 Cara Beli:\n1. Pilih Produk\n2. Masukkan Nomer\n3. Bayar (QRIS/Saldo)\n\nJika gagal, saldo refund otomatis.', {reply_markup:{inline_keyboard:[[Markup.button.callback('Back','back_home')]]}}));
bot.action('info_bot', (ctx) => ctx.editMessageText('ℹ️ <b>WINTUNELING VPN</b>\n@wintunelingvpnBot\n@wintunelingzivpnBot\nChannel: @WINTUNELINGVPNN', {parse_mode:'HTML', reply_markup:{inline_keyboard:[[Markup.button.callback('Back','back_home')]]}}));

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
EOBOT

# 6. Install Modules & Start
echo "[+] Menginstall Modules..."
npm init -y > /dev/null
npm install telegraf axios sqlite3 qs

echo "[+] Menjalankan Bot dengan PM2..."
pm2 start bot.js --name "wintuneling"
pm2 save
pm2 startup

echo -e "${GREEN}[SUCCESS] Bot Berhasil Diinstall!${NC}"
echo "Ketik 'pm2 logs wintuneling' untuk melihat status."
EOF

chmod +x setup_wintuneling.sh
bash setup_wintuneling.sh
