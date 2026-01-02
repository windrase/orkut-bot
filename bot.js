# 1. Pastikan di folder root/home
cd ~

# 2. Buat file installer otomatis
cat << 'EOF' > install_bot.sh
#!/bin/bash
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}[+] MEMULAI INSTALASI WINTUNELING BOT...${NC}"

# A. Install Node.js & PM2 (Cek jika belum ada)
if ! command -v node &> /dev/null; then
    echo "[-] Menginstall Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt-get install -y nodejs
fi

if ! command -v pm2 &> /dev/null; then
    echo "[-] Menginstall PM2..."
    npm install -g pm2
fi

# B. Buat Folder Project (Agar rapi)
# Hapus folder lama jika ada untuk instalasi bersih
rm -rf wintuneling-bot
mkdir -p wintuneling-bot
cd wintuneling-bot

# C. Input Data Konfigurasi
echo -e "\n${GREEN}[!] SETUP KONFIGURASI:${NC}"
read -p "1. Bot Token: " IN_TOKEN
read -p "2. ID Admin (Angka): " IN_ADMIN
read -p "3. ID Channel (-100...): " IN_CHANNEL
read -p "4. Username OrderKuota: " IN_OK_USER
read -p "5. Token OrderKuota: " IN_OK_TOKEN
read -p "6. QRIS String: " IN_QRIS

# D. Buat File config.js
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

# E. Buat File bot.js (Kode Utama)
cat << 'EOBOT' > bot.js
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const qs = require('qs');
const CONFIG = require('./config.js');

const bot = new Telegraf(CONFIG.BOT_TOKEN);
const db = new sqlite3.Database('wintuneling.db');
const globalState = {}; global.pendingTrx = {}; 

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, saldo INTEGER DEFAULT 0, name TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT, category TEXT, price_buy INTEGER, price_sell INTEGER)");
});

const formatRp = (n) => 'Rp ' + parseInt(n).toLocaleString('id-ID');
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

bot.command('admin', (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    ctx.reply('🔧 ADMIN PANEL', {reply_markup: {inline_keyboard: [[Markup.button.callback('➕ Tambah Produk', 'adm_add')]]}});
});

bot.action('adm_add', (ctx) => { globalState[ctx.from.id] = {step:'CODE'}; ctx.reply('➡️ Kode Produk (API):'); });

bot.on('text', async (ctx, next) => {
    const uid = ctx.from.id; const s = globalState[uid]; const txt = ctx.message.text;
    if(s && uid===CONFIG.ADMIN_ID && s.step) {
        if(s.step==='CODE') { s.code=txt; s.step='NAME'; return ctx.reply('➡️ Nama Tampilan:'); }
        if(s.step==='NAME') { s.name=txt; s.step='CAT'; return ctx.reply('➡️ Kategori (XL/INDOSAT):'); }
        if(s.step==='CAT') { s.cat=txt.toUpperCase(); s.step='BUY'; return ctx.reply('➡️ Harga Beli:'); }
        if(s.step==='BUY') { s.buy=parseInt(txt); s.step='SELL'; return ctx.reply('➡️ Harga Jual:'); }
        if(s.step==='SELL') {
            db.run("INSERT INTO products (code, name, category, price_buy, price_sell) VALUES (?,?,?,?,?)", [s.code, s.name, s.cat, s.buy, parseInt(txt)]);
            ctx.reply('✅ Produk Tersimpan!'); delete globalState[uid]; return;
        }
    }
    if(s && s.mode==='INPUT') {
        const num = txt.replace(/[^0-9]/g,''); if(num.length<9) return ctx.reply('⚠️ Nomor tidak valid');
        const p = s.prod;
        ctx.reply(`🧾 <b>KONFIRMASI</b>\n📦 ${p.name}\n📱 ${num}\n💸 ${formatRp(p.price_sell)}`, {parse_mode:'HTML', reply_markup:{inline_keyboard:[
            [Markup.button.callback('💳 Saldo', `pay_saldo_${p.id}_${num}`)],
            [Markup.button.callback('⚡ QRIS', `pay_qris_${p.id}_${num}`)],
            [Markup.button.callback('❌ Batal', 'home')]
        ]}}); delete globalState[uid]; return;
    }
    next();
});

bot.start((ctx) => {
    db.get("SELECT saldo FROM users WHERE user_id=?", [ctx.from.id], (e,r) => {
        if(!r) db.run("INSERT INTO users (user_id,name) VALUES (?,?)",[ctx.from.id, ctx.from.first_name]);
        const bal = r?r.saldo:0;
        ctx.reply(`🔥 <b>WINTUNELING STORE</b>\n💰 Saldo: ${formatRp(bal)}\n👇 Menu Transaksi:`, {parse_mode:'HTML', reply_markup:{inline_keyboard:[[Markup.button.callback('🛒 Beli Kuota','menu'),Markup.button.callback('💳 Isi Saldo','topup')],[Markup.button.callback('📚 Panduan','info')]]}});
    });
});

bot.action('home', (ctx) => { ctx.deleteMessage().catch(()=>{}); ctx.telegram.sendCopy(ctx.chat.id, {text:'/start'}); });
bot.action('menu', (ctx) => ctx.editMessageText('📡 <b>PILIH PROVIDER</b>', {parse_mode:'HTML', reply_markup:{inline_keyboard:[[Markup.button.callback('XL','list_XL'),Markup.button.callback('Indosat','list_INDOSAT')],[Markup.button.callback('🏠 Kembali','home')]]}}).catch(()=>{}));

bot.action(/list_(.+)/, (ctx) => {
    const c = ctx.match[1];
    db.all("SELECT * FROM products WHERE category=?",[c],(e,r)=>{
        if(!r||!r.length) return ctx.answerCbQuery('Produk Kosong',{show_alert:true});
        const b=[]; let t=[]; r.forEach(p=>{ t.push(Markup.button.callback(`${p.name} • ${p.price_sell/1000}k`,`buy_${p.id}`)); if(t.length===2){b.push(t);t=[];} });
        if(t.length) b.push(t); b.push([Markup.button.callback('🔙 Kembali','menu')]);
        ctx.editMessageText(`📦 <b>KATALOG ${c}</b>`,{parse_mode:'HTML', reply_markup:{inline_keyboard:b}}).catch(()=>{});
    });
});

bot.action(/buy_(\d+)/, (ctx) => {
    db.get("SELECT * FROM products WHERE id=?",[ctx.match[1]],(e,r)=>{
        globalState[ctx.from.id]={mode:'INPUT',prod:r}; ctx.editMessageText(`📝 Masukkan Nomor HP Tujuan <b>${r.name}</b>:`,{parse_mode:'HTML'});
    });
});

bot.action(/pay_saldo_(\d+)_(.+)/, (ctx) => {
    const [_,pid,num] = ctx.match; const uid=ctx.from.id;
    db.get("SELECT saldo FROM users WHERE user_id=?",[uid],(e,u)=>{
        db.get("SELECT * FROM products WHERE id=?",[pid],(e,p)=>{
            if(u.saldo<p.price_sell) return ctx.answerCbQuery('Saldo Tidak Cukup!',{show_alert:true});
            db.run("UPDATE users SET saldo=saldo-? WHERE user_id=?",[p.price_sell,uid]);
            ctx.deleteMessage().catch(()=>{}); proc(uid,p,num,'SALDO',p.price_sell);
        });
    });
});

bot.action(/pay_qris_(\d+)_(.+)/, (ctx) => {
    db.get("SELECT * FROM products WHERE id=?",[ctx.match[1]],(e,p)=> createQRIS(ctx,p.price_sell,'PURCHASE',{prod:p,target:ctx.match[2]}));
});

bot.action('topup', (ctx) => ctx.editMessageText('💰 Nominal Deposit:',{reply_markup:{inline_keyboard:[[Markup.button.callback('10rb','d_10000'),Markup.button.callback('25rb','d_25000')],[Markup.button.callback('50rb','d_50000'),Markup.button.callback('🏠 Batal','home')]]}}));
bot.action(/d_(\d+)/, (ctx) => createQRIS(ctx,parseInt(ctx.match[1]),'DEPOSIT',{}));

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
            caption: `📥 <b>TOTAL: ${formatRp(finalAmount)}</b>\nBayar 3 digit terakhir sesuai!\nCek otomatis 2 menit.`, parse_mode:'HTML'
        });
        global.pendingTrx[uniqueCode] = { uniqueCode, userId: ctx.from.id, amount: finalAmount, type, data, timestamp: Date.now(), msgId: msg.message_id };
    } catch(e) { ctx.reply('❌ Gagal QRIS'); }
}

async function proc(uid, prod, target, method, amount) {
    bot.telegram.sendMessage(uid, '⏳ Memproses...');
    const url = prod.category === 'XL' ? 'https://cybersolution.my.id/api/order-xl' : 'https://cybersolution.my.id/api/order-indosat';
    try {
        const r = await axios.post(url, { auth_token: CONFIG.OK_TOKEN.split(':')[1] || CONFIG.OK_TOKEN, auth_username: CONFIG.OK_USERNAME, target_number: target, voucher_id: prod.code });
        if(r.data.success || r.data.status === 'Sukses') {
            bot.telegram.sendMessage(uid, `✅ SUKSES!\nSN: ${r.data.transaction_details?.sn}`);
            bot.telegram.sendMessage(CONFIG.CHANNEL_ID, `🔔 SOLD ${prod.name}\nProfit: ${formatRp(prod.price_sell - prod.price_buy)}`);
        } else throw new Error(r.data.message);
    } catch(e) {
        bot.telegram.sendMessage(uid, `❌ GAGAL: ${e.message}\nDana dikembalikan.`);
        db.run("UPDATE users SET saldo = saldo + ? WHERE user_id=?", [amount, uid]);
    }
}

async function check() {
    if(!Object.keys(global.pendingTrx).length) return;
    try {
        const r = await axios.post('https://orkutapi.andyyuda41.workers.dev/api/qris-history', qs.stringify({username:CONFIG.OK_USERNAME, token:CONFIG.OK_TOKEN, jenis:'masuk'}), {headers:{'Content-Type':'application/x-www-form-urlencoded'}});
        const txt = typeof r.data==='string'?r.data:JSON.stringify(r.data);
        const inc = []; txt.split('----------').forEach(b=>{const m=b.match(/Kredit\s*:\s*(?:Rp\s*)?([\d.]+)/i); if(m) inc.push(parseInt(m[1].replace(/\./g,'')));});
        for(const [c,t] of Object.entries(global.pendingTrx)) {
            if(Date.now()-t.timestamp>600000){delete global.pendingTrx[c];continue;}
            if(inc.includes(t.amount)) {
                bot.telegram.deleteMessage(t.userId, t.msgId).catch(()=>{}); delete global.pendingTrx[c];
                if(t.type==='DEPOSIT') { db.run("UPDATE users SET saldo=saldo+? WHERE user_id=?",[t.amount,t.userId]); bot.telegram.sendMessage(t.userId,`✅ Deposit Masuk ${formatRp(t.amount)}`); }
                else proc(t.userId,t.data.prod,t.data.target,'QRIS',t.amount);
            }
        }
    } catch(e){}
}
setInterval(check,10000);

bot.action('info', (ctx) => ctx.reply('ℹ️ @wintunelingvpnBot'));
bot.launch(); process.once('SIGINT', () => bot.stop('SIGINT'));
EOBOT

# F. Fix Error "No package.json" & Install Modules
echo -e "${GREEN}[+] MENGINSTALL MODUL (FIX ERROR)...${NC}"
# Inisialisasi package.json otomatis agar tidak error ENOENT
npm init -y > /dev/null

# Install modul yang diperlukan
npm install telegraf axios sqlite3 qs

# G. Jalankan Bot
echo -e "${GREEN}[+] MENJALANKAN BOT...${NC}"
pm2 start bot.js --name "wintuneling" --update-env
pm2 save
pm2 startup

echo -e "${GREEN}[SUCCESS] Bot Berhasil Terinstall!${NC}"
echo "Ketik 'pm2 logs wintuneling' untuk cek status."
EOF

# H. Eksekusi Script
chmod +x install_bot.sh
bash install_bot.sh
