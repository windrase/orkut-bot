/*
  🔥 WINTUNELING STORE BOT (FINAL REVISED CODE)
  Features: 
  - Topup Saldo Manual Input
  - Auto Check Mutasi QRIS (Realtime)
  - Transaksi API OrderKuota
  - Auto Refund System
*/

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const qs = require('qs');

// ============================================================
// 1. KONFIGURASI PENTING
// ============================================================
const CONFIG = {
    BOT_TOKEN: '8437818788:AAEkujLT_c-euE5gHVruvF8ceOcH-cruw0c', 
    ADMIN_ID: 6047772290, 
    CHANNEL_ID: '-1002727126984', 

    // Data API OrderKuota
    OK_USERNAME: 'allufi', 
    OK_TOKEN: '1991647:0jkip97VR6huEtrc2XvWUDsOBY5yFMxA', 

    // Data QRIS & Payment
    QRIS_STATIC_STRING: '00020101021126670016COM.NOBUBANK.WWW01189360050300000879140214052524280562170303UMI51440014ID.CO.QRIS.WWW0215ID20243395055030303UMI5204481253033605802ID5919HABS CELL OK19916476015JAKARTA SELATAN61051211062070703A0163045BB5', 
    PAYMENT_API_KEY: 'AriApiPaymetGetwayMod' 
};

// ============================================================
// 2. INITIALIZATION
// ============================================================
const bot = new Telegraf(CONFIG.BOT_TOKEN);
const db = new sqlite3.Database('wintuneling.db');

// State Memory
const globalState = {}; 
global.pendingTrx = {}; 

// Database Setup
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, saldo INTEGER DEFAULT 0, name TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT, category TEXT, price_buy INTEGER, price_sell INTEGER)");
});

// Helper Functions
const formatRp = (n) => 'Rp ' + parseInt(n).toLocaleString('id-ID');
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

// ============================================================
// 3. ADMIN PANEL
// ============================================================
bot.command('admin', (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    ctx.reply('🔧 <b>ADMIN DASHBOARD</b>', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [Markup.button.callback('➕ Tambah Produk', 'adm_add')],
                [Markup.button.callback('📜 List Produk', 'adm_list')]
            ]
        }
    });
});

bot.action('adm_add', (ctx) => {
    globalState[ctx.from.id] = { step: 'INPUT_CODE' };
    ctx.reply('➡️ Masukkan <b>KODE PRODUK</b> API:', {parse_mode:'HTML'});
});

// ============================================================
// 4. INPUT HANDLER (TEXT MESSAGE)
// ============================================================
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = globalState[userId];
    const text = ctx.message.text;

    // --- A. LOGIKA ADMIN ---
    if (state && userId === CONFIG.ADMIN_ID && state.step) {
        if (state.step === 'INPUT_CODE') { state.code = text; state.step = 'INPUT_NAME'; return ctx.reply('➡️ Nama Tampilan:'); }
        if (state.step === 'INPUT_NAME') { state.name = text; state.step = 'INPUT_CAT'; return ctx.reply('➡️ Kategori (XL/INDOSAT):'); }
        if (state.step === 'INPUT_CAT') { state.category = text.toUpperCase(); state.step = 'INPUT_BUY'; return ctx.reply('➡️ Harga Beli:'); }
        if (state.step === 'INPUT_BUY') { state.price_buy = parseInt(text); state.step = 'INPUT_SELL'; return ctx.reply('➡️ Harga Jual:'); }
        if (state.step === 'INPUT_SELL') {
            db.run("INSERT INTO products (code, name, category, price_buy, price_sell) VALUES (?,?,?,?,?)", 
                [state.code, state.name, state.category, state.price_buy, parseInt(text)], (err) => {
                    ctx.reply(err ? '❌ Error DB' : `✅ Produk <b>${state.name}</b> Disimpan!`, {parse_mode:'HTML'});
                });
            delete globalState[userId]; return;
        }
    }

    // --- B. LOGIKA USER (INPUT NOMOR HP UNTUK BELI) ---
    if (state && state.mode === 'INPUT_NUMBER') {
        const target = text.replace(/[^0-9]/g, '');
        if (target.length < 9) return ctx.reply('⚠️ Nomor tidak valid.');
        
        const prod = state.product;
        ctx.reply(`🧾 <b>KONFIRMASI ORDER</b>\n📦 ${prod.name}\n📱 ${target}\n💸 ${formatRp(prod.price_sell)}`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
                [Markup.button.callback(`💳 Saldo`, `pay_saldo_${prod.id}_${target}`)],
                [Markup.button.callback(`⚡ QRIS`, `pay_qris_${prod.id}_${target}`)],
                [Markup.button.callback('❌ Batal', 'back_home')]
            ]}
        });
        delete globalState[userId]; return;
    }

    // --- C. LOGIKA USER (INPUT NOMINAL DEPOSIT MANUAL) ---
    if (state && state.mode === 'INPUT_DEPOSIT') {
        const nominal = parseInt(text.replace(/[^0-9]/g, ''));
        
        if (isNaN(nominal) || nominal < 1000) {
            return ctx.reply('⚠️ Nominal tidak valid. Minimal Rp 1.000.\nSilakan ketik ulang:');
        }

        // Generate QRIS Deposit Langsung
        createQRIS(ctx, nominal, 'DEPOSIT', {});
        delete globalState[userId];
        return;
    }

    next();
});

// ============================================================
// 5. USER MENU & NAVIGATION
// ============================================================
bot.start((ctx) => {
    db.get("SELECT * FROM users WHERE user_id = ?", [ctx.from.id], (err, row) => {
        if (!row) db.run("INSERT INTO users (user_id, name) VALUES (?,?)", [ctx.from.id, ctx.from.first_name]);
        const saldo = row ? row.saldo : 0;
        
        ctx.reply(`🔥 <b>WINTUNELING STORE</b>\n👋 Halo ${ctx.from.first_name}\n💰 Saldo: <b>${formatRp(saldo)}</b>\n\n👇 Pilih menu transaksi:`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
                [Markup.button.callback('🛒 Beli Kuota', 'menu_beli'), Markup.button.callback('💳 Isi Saldo', 'topup_saldo')],
                [Markup.button.callback('📚 Panduan', 'panduan'), Markup.button.callback('ℹ️ Info', 'info_bot')]
            ]}
        });
    });
});

bot.action('back_home', (ctx) => { ctx.deleteMessage().catch(()=>{}); ctx.telegram.sendCopy(ctx.chat.id, {text: '/start'}); });

bot.action('menu_beli', (ctx) => {
    ctx.editMessageText('📡 <b>PILIH PROVIDER</b>', { 
        parse_mode:'HTML', 
        reply_markup: { inline_keyboard: [[Markup.button.callback('🔵 XL', 'list_XL'), Markup.button.callback('🟡 Indosat', 'list_INDOSAT')], [Markup.button.callback('🏠 Home', 'back_home')]] } 
    }).catch(()=>{});
});

bot.action(/list_(.+)/, (ctx) => {
    const cat = ctx.match[1];
    db.all("SELECT * FROM products WHERE category = ?", [cat], (err, rows) => {
        if (!rows || !rows.length) return ctx.answerCbQuery('⚠️ Kosong', {show_alert:true});
        const buttons = []; let temp = [];
        rows.forEach(p => { 
            temp.push(Markup.button.callback(`${p.name} • ${p.price_sell/1000}k`, `buy_prod_${p.id}`)); 
            if(temp.length===2){ buttons.push(temp); temp=[]; } 
        });
        if(temp.length) buttons.push(temp);
        buttons.push([Markup.button.callback('🔙 Kembali', 'menu_beli')]);
        ctx.editMessageText(`📦 <b>KATALOG ${cat}</b>`, {parse_mode:'HTML', reply_markup: {inline_keyboard: buttons}}).catch(()=>{});
    });
});

bot.action(/buy_prod_(\d+)/, (ctx) => {
    db.get("SELECT * FROM products WHERE id=?", [ctx.match[1]], (err, row) => {
        globalState[ctx.from.id] = { mode: 'INPUT_NUMBER', product: row };
        ctx.editMessageText(`📝 Masukkan Nomor HP Tujuan <b>${row.name}</b>:`, {parse_mode:'HTML'});
    });
});

// ============================================================
// 6. PAYMENT SYSTEM (SALDO & QRIS)
// ============================================================

// Bayar Pakai Saldo
bot.action(/pay_saldo_(\d+)_(.+)/, (ctx) => {
    const [_, pid, target] = ctx.match;
    const uid = ctx.from.id;
    
    db.get("SELECT saldo FROM users WHERE user_id=?", [uid], (e, u) => {
        db.get("SELECT * FROM products WHERE id=?", [pid], (e, p) => {
            if(u.saldo < p.price_sell) return ctx.answerCbQuery('❌ Saldo Kurang!', {show_alert:true});
            db.run("UPDATE users SET saldo = saldo - ? WHERE user_id=?", [p.price_sell, uid]);
            ctx.deleteMessage().catch(()=>{});
            processOrder(ctx.telegram, uid, p, target, 'SALDO', p.price_sell);
        });
    });
});

// Bayar Pakai QRIS Langsung
bot.action(/pay_qris_(\d+)_(.+)/, (ctx) => {
    db.get("SELECT * FROM products WHERE id=?", [ctx.match[1]], (e, p) => createQRIS(ctx, p.price_sell, 'PURCHASE', {prod:p, target:ctx.match[2]}));
});

// Topup Saldo (Manual Input)
bot.action('topup_saldo', (ctx) => {
    globalState[ctx.from.id] = { mode: 'INPUT_DEPOSIT' };
    ctx.editMessageText('💰 <b>ISI SALDO</b>\n\nSilakan ketik nominal deposit (Min Rp 1.000).\nContoh: <code>25000</code>', {
        parse_mode:'HTML', 
        reply_markup:{inline_keyboard:[[Markup.button.callback('🔙 Batal', 'back_home')]]}
    });
});

// Fungsi Buat QRIS
async function createQRIS(ctx, amount, type, data) {
    const finalAmount = amount + rand(1, 150); // Kode unik
    const uniqueCode = `trx-${ctx.from.id}-${Date.now()}`;
    
    try {
        ctx.reply('⏳ <i>Membuat QRIS...</i>', {parse_mode:'HTML'});
        const res = await axios.get(`https://api.rajaserverpremium.web.id/orderkuota/createpayment`, {
            params: { apikey: CONFIG.PAYMENT_API_KEY, amount: finalAmount, codeqr: CONFIG.QRIS_STATIC_STRING }, timeout: 10000
        });

        if (res.data.status !== 'success') throw new Error();
        
        const caption = type === 'DEPOSIT' ? `📥 <b>INVOICE DEPOSIT</b>` : `🛍️ <b>INVOICE PEMBELIAN</b>\n📦 ${data.prod.name}`;
        const msg = await ctx.replyWithPhoto(res.data.result.imageqris.url, {
            caption: `${caption}\n💰 Total: <b>${formatRp(finalAmount)}</b>\n⚠️ Bayar SESUAI nominal (3 digit terakhir).\n✅ Cek otomatis berkala.`, 
            parse_mode:'HTML'
        });
        
        global.pendingTrx[uniqueCode] = { uniqueCode, userId: ctx.from.id, amount: finalAmount, type, data, timestamp: Date.now(), msgId: msg.message_id };

    } catch (e) { ctx.reply('❌ Gagal QRIS. Coba lagi.'); }
}

// ============================================================
// 7. ORDER PROCESSING & AUTO REFUND
// ============================================================
async function processOrder(telegram, userId, prod, target, method, paidAmount) {
    telegram.sendMessage(userId, '⏳ <i>Memproses transaksi...</i>', {parse_mode:'HTML'});

    const apiUrl = prod.category === 'XL' ? 'https://cybersolution.my.id/api/order-xl' : 'https://cybersolution.my.id/api/order-indosat';
    
    try {
        const payload = {
            auth_token: CONFIG.OK_TOKEN.split(':')[1] || CONFIG.OK_TOKEN,
            auth_username: CONFIG.OK_USERNAME,
            target_number: target,
            voucher_id: prod.code
        };

        const res = await axios.post(apiUrl, payload);

        if (res.data.success || res.data.status === 'Sukses') {
            const sn = res.data.transaction_details?.sn || 'Sedang Proses';
            telegram.sendMessage(userId, `✅ <b>SUKSES!</b>\n📦 ${prod.name}\n📱 ${target}\n🔢 SN: <code>${sn}</code>`, {parse_mode:'HTML'});
            
            const profit = prod.price_sell - prod.price_buy;
            telegram.sendMessage(CONFIG.CHANNEL_ID, `🔔 <b>ORDER SUKSES (${method})</b>\nUser: ${userId}\nItem: ${prod.name}\nProfit: ${formatRp(profit)}`, {parse_mode:'HTML'});
        } else {
            throw new Error(res.data.message || 'Gagal');
        }

    } catch (e) {
        // Auto Refund
        telegram.sendMessage(userId, `❌ <b>GAGAL:</b> ${e.message}\n🔄 Dana dikembalikan ke Saldo.`, {parse_mode:'HTML'});
        db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [paidAmount, userId]);
    }
}

// ============================================================
// 8. AUTO CHECK MUTASI (REALTIME)
// ============================================================
async function checkMutation() {
    if (!Object.keys(global.pendingTrx).length) return; 

    try {
        const res = await axios.post('https://orkutapi.andyyuda41.workers.dev/api/qris-history', 
            qs.stringify({username: CONFIG.OK_USERNAME, token: CONFIG.OK_TOKEN, jenis: 'masuk'}), 
            {headers: {'Content-Type': 'application/x-www-form-urlencoded'}}
        );

        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        const incoming = [];
        text.split('------------------------').forEach(b => {
             const m = b.match(/Kredit\s*:\s*(?:Rp\s*)?([\d.]+)/i);
             if(m) incoming.push(parseInt(m[1].replace(/\./g, '')));
        });

        for (const [code, trx] of Object.entries(global.pendingTrx)) {
            if (Date.now() - trx.timestamp > 600000) { delete global.pendingTrx[code]; continue; }
            
            if (incoming.includes(trx.amount)) {
                bot.telegram.deleteMessage(trx.userId, trx.msgId).catch(()=>{});
                delete global.pendingTrx[code];

                if (trx.type === 'DEPOSIT') {
                    db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [trx.amount, trx.userId]);
                    bot.telegram.sendMessage(trx.userId, `✅ <b>DEPOSIT MASUK</b>\nSaldo +${formatRp(trx.amount)}`, {parse_mode:'HTML'});
                    bot.telegram.sendMessage(CONFIG.CHANNEL_ID, `💰 DEPOSIT: ${formatRp(trx.amount)} (User: ${trx.userId})`);
                } else {
                    processOrder(bot.telegram, trx.userId, trx.data.prod, trx.data.target, 'QRIS', trx.amount);
                }
            }
        }
    } catch (e) {}
}
// Cek mutasi setiap 10 detik
setInterval(checkMutation, 10000);

// ============================================================
// 9. OTHER MENUS
// ============================================================
bot.action('panduan', (ctx) => ctx.editMessageText('📚 <b>Cara Beli:</b>\n1. Pilih Produk\n2. Masukkan Nomor\n3. Bayar (QRIS/Saldo)\n\n<i>*Jika gagal, saldo refund otomatis.</i>', {parse_mode:'HTML', reply_markup:{inline_keyboard:[[Markup.button.callback('Kembali', 'back_home')]]}}));
bot.action('info_bot', (ctx) => ctx.editMessageText('ℹ️ <b>WINTUNELING VPN</b>\nBot Topup & VPN.\nChannel: @WINTUNELINGVPNN', {parse_mode:'HTML', reply_markup:{inline_keyboard:[[Markup.button.callback('Kembali', 'back_home')]]}}));

bot.launch().then(() => console.log('✅ Bot Started!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
