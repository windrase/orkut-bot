/*
  🤖 WINTUNELING STORE BOT (FINAL VERSION)
  Features: Direct QRIS, Auto Refund, Multi-Pricing, Text-Based Menu
*/

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const qs = require('qs');

// ==========================================
// 1. KONFIGURASI (WAJIB DIISI)
// ==========================================
const CONFIG = {
    // Token Bot dari @BotFather
    BOT_TOKEN: '8437818788:AAEkujLT_c-euE5gHVruvF8ceOcH-cruw0c', 
    
    // ID Telegram Admin (Supaya bisa tambah produk)
    ADMIN_ID: 6047772290, 
    
    // ID Channel untuk Laporan Transaksi (awalan -100)
    CHANNEL_ID: '-1002727126984', 
    
    // API OrderKuota (Sumber Stok)
    OK_USERNAME: 'allufi', 
    OK_TOKEN: '1991647:0jkip97VR6huEtrc2XvWUDsOBY5yFMxA', 
    
    // QRIS String (Data QRIS Statis dari NURIS/OrderKuota)
    QRIS_STATIC_STRING: '00020101021126670016COM.NOBUBANK.WWW01189360050300000879140214052524280562170303UMI51440014ID.CO.QRIS.WWW0215ID20243395055030303UMI5204481253033605802ID5919HABS CELL OK19916476015JAKARTA SELATAN61051211062070703A0163045BB5', 
    
    // API Key RajaServer (Untuk generate QRIS dinamis)
    PAYMENT_API_KEY: 'AriApiPaymetGetwayMod' 
};

// ==========================================
// 2. DATABASE & SYSTEM SETUP
// ==========================================
const bot = new Telegraf(CONFIG.BOT_TOKEN);
const db = new sqlite3.Database('wintuneling.db');

// State Memory (Temporary)
const globalState = {}; 
global.pendingTrx = {}; // Menyimpan transaksi yang menunggu pembayaran

// Inisialisasi Database
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, saldo INTEGER DEFAULT 0, name TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT, category TEXT, price_buy INTEGER, price_sell INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS history (trx_id TEXT, user_id INTEGER, product TEXT, price INTEGER, status TEXT, date TEXT)");
});

// Helper Rupiah
const formatRp = (angka) => 'Rp ' + parseInt(angka).toLocaleString('id-ID');
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

// ==========================================
// 3. ADMIN PANEL (TAMBAH PRODUK)
// ==========================================

// Command: /admin
bot.command('admin', (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    ctx.reply('🔧 <b>ADMIN PANEL</b>', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [Markup.button.callback('➕ Tambah Produk', 'adm_add')],
                [Markup.button.callback('🗑 Hapus Produk', 'adm_del')]
            ]
        }
    });
});

bot.action('adm_add', (ctx) => {
    globalState[ctx.from.id] = { step: 'INPUT_CODE' };
    ctx.reply('➡️ Masukkan <b>KODE PRODUK</b> dari API (Cth: XLD10):', { parse_mode: 'HTML' });
});

// Handler Text (Input Admin & Input Nomor User)
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = globalState[userId];
    const text = ctx.message.text;

    // --- LOGIKA ADMIN ---
    if (state && userId === CONFIG.ADMIN_ID && state.step) {
        if (state.step === 'INPUT_CODE') {
            state.code = text;
            state.step = 'INPUT_NAME';
            return ctx.reply('➡️ Masukkan <b>NAMA TAMPILAN</b> (Cth: XL 10GB):');
        }
        if (state.step === 'INPUT_NAME') {
            state.name = text;
            state.step = 'INPUT_CAT';
            return ctx.reply('➡️ Masukkan <b>KATEGORI</b> (XL / INDOSAT):');
        }
        if (state.step === 'INPUT_CAT') {
            state.category = text.toUpperCase();
            state.step = 'INPUT_BUY';
            return ctx.reply('➡️ Masukkan <b>HARGA BELI</b> (Modal):');
        }
        if (state.step === 'INPUT_BUY') {
            state.price_buy = parseInt(text);
            state.step = 'INPUT_SELL';
            return ctx.reply('➡️ Masukkan <b>HARGA JUAL</b> (Ke User):');
        }
        if (state.step === 'INPUT_SELL') {
            const priceSell = parseInt(text);
            db.run("INSERT INTO products (code, name, category, price_buy, price_sell) VALUES (?,?,?,?,?)", 
                [state.code, state.name, state.category, state.price_buy, priceSell], (err) => {
                    ctx.reply(err ? '❌ Gagal simpan DB' : `✅ Produk <b>${state.name}</b> tersimpan!`, {parse_mode:'HTML'});
                });
            delete globalState[userId];
            return;
        }
    }

    // --- LOGIKA USER INPUT NOMOR ---
    if (state && state.mode === 'INPUT_NUMBER') {
        const target = text.replace(/[^0-9]/g, ''); // Ambil angka saja
        if (target.length < 9) return ctx.reply('⚠️ Nomor tidak valid, ulangi.');
        
        const prod = state.product;
        
        // Tampilan Konfirmasi (Struk Text)
        const msg = `
🧾 <b>KONFIRMASI ORDER</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 <b>Produk:</b> ${prod.name}
🏷 <b>Provider:</b> ${prod.category}
📱 <b>Tujuan:</b> <code>${target}</code>
💸 <b>Harga:</b> ${formatRp(prod.price_sell)}
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>Silahkan pilih metode pembayaran:</i>`;
        
        ctx.reply(msg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback(`💳 Saldo (${formatRp(prod.price_sell)})`, `pay_saldo_${prod.id}_${target}`)],
                    [Markup.button.callback(`⚡ QRIS (Instant)`, `pay_qris_${prod.id}_${target}`)],
                    [Markup.button.callback('❌ Batal', 'back_home')]
                ]
            }
        });
        delete globalState[userId]; // Reset state
        return;
    }

    next();
});

// ==========================================
// 4. USER MENU & FLOW
// ==========================================

bot.start((ctx) => {
    db.get("SELECT * FROM users WHERE user_id = ?", [ctx.from.id], (err, row) => {
        if (!row) db.run("INSERT INTO users (user_id, name) VALUES (?,?)", [ctx.from.id, ctx.from.first_name]);
        
        const saldo = row ? row.saldo : 0;
        const cleanName = ctx.from.first_name.replace(/</g, '');

        const text = `
🔥 <b>WINTUNELING STORE BOT</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👋 <b>Halo, ${cleanName}!</b>
Selamat datang di layanan topup otomatis 24 Jam.

📊 <b>INFO AKUN</b>
🆔 ID: <code>${ctx.from.id}</code>
💰 Saldo: <b>${formatRp(saldo)}</b>
📡 Status: <b>Online</b>

<i>Silahkan pilih menu dibawah ini:</i>`;

        // Gunakan reply biasa (bukan edit) untuk start
        ctx.reply(text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🛒 Beli Kuota', 'menu_beli'), Markup.button.callback('💳 Isi Saldo', 'topup_saldo')],
                    [Markup.button.callback('📚 Cara Beli', 'panduan'), Markup.button.callback('ℹ️ Info Bot', 'info_bot')],
                    [Markup.button.callback('📞 Admin Support', 'contact')]
                ]
            }
        });
    });
});

// Navigasi Back Home
bot.action('back_home', (ctx) => {
    ctx.deleteMessage().catch(()=>{});
    // Redirect logic ke start (copy paste isi start atau trigger manual)
    // Disini kita trigger manual pesan start
    const userId = ctx.from.id;
    db.get("SELECT saldo FROM users WHERE user_id = ?", [userId], (err, row) => {
        const saldo = row ? row.saldo : 0;
        const text = `🔥 <b>WINTUNELING STORE BOT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👋 Halo!\n💰 Saldo: <b>${formatRp(saldo)}</b>\n\n<i>Silahkan pilih menu:</i>`;
        ctx.reply(text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🛒 Beli Kuota', 'menu_beli'), Markup.button.callback('💳 Isi Saldo', 'topup_saldo')],
                    [Markup.button.callback('📚 Cara Beli', 'panduan'), Markup.button.callback('ℹ️ Info Bot', 'info_bot')]
                ]
            }
        });
    });
});

// Menu Pilih Provider
bot.action('menu_beli', (ctx) => {
    ctx.editMessageText(`
<b>📡 PILIH PROVIDER</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
Pilih operator seluler tujuan:`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [Markup.button.callback('🔵 XL Axiata', 'list_XL'), Markup.button.callback('🟡 Indosat', 'list_INDOSAT')],
                [Markup.button.callback('🏠 Menu Utama', 'back_home')]
            ]
        }
    }).catch(()=>{});
});

// List Produk (Grid 2 Kolom)
bot.action(/list_(.+)/, (ctx) => {
    const cat = ctx.match[1];
    db.all("SELECT * FROM products WHERE category = ?", [cat], (err, rows) => {
        if (!rows || rows.length === 0) return ctx.answerCbQuery('⚠️ Produk kosong', {show_alert:true});
        
        const buttons = [];
        let tempRow = [];
        
        rows.forEach((p) => {
            const priceK = (p.price_sell / 1000) + 'rb';
            tempRow.push(Markup.button.callback(`${p.name} • ${priceK}`, `buy_prod_${p.id}`));
            if (tempRow.length === 2) { buttons.push(tempRow); tempRow = []; }
        });
        if (tempRow.length > 0) buttons.push(tempRow);
        buttons.push([Markup.button.callback('🔙 Kembali', 'menu_beli')]);

        ctx.editMessageText(`📦 <b>KATALOG ${cat}</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nPilih paket:`, {
            parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons }
        }).catch(()=>{});
    });
});

// Trigger Input Nomor
bot.action(/buy_prod_(\d+)/, (ctx) => {
    const prodId = ctx.match[1];
    db.get("SELECT * FROM products WHERE id = ?", [prodId], (err, row) => {
        globalState[ctx.from.id] = { mode: 'INPUT_NUMBER', product: row };
        ctx.editMessageText(`📝 <b>INPUT NOMOR TUJUAN</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n📦 <b>${row.name}</b>\n\nSilahkan ketik nomor HP (Awalan 08xxx):`, {parse_mode: 'HTML'});
    });
});

// ==========================================
// 5. SISTEM PEMBAYARAN & EKSEKUSI
// ==========================================

// A. Bayar Saldo
bot.action(/pay_saldo_(\d+)_(.+)/, (ctx) => {
    const prodId = ctx.match[1];
    const target = ctx.match[2];
    const userId = ctx.from.id;

    db.get("SELECT saldo FROM users WHERE user_id = ?", [userId], (err, user) => {
        db.get("SELECT * FROM products WHERE id = ?", [prodId], (err, prod) => {
            if (user.saldo < prod.price_sell) return ctx.answerCbQuery('❌ Saldo kurang! Silahkan Topup.', { show_alert: true });

            // Potong Saldo
            db.run("UPDATE users SET saldo = saldo - ? WHERE user_id = ?", [prod.price_sell, userId]);
            // Eksekusi
            ctx.deleteMessage().catch(()=>{});
            processOrder(ctx, userId, prod, target, 'SALDO', prod.price_sell);
        });
    });
});

// B. Bayar QRIS (Dan Topup)
bot.action(/pay_qris_(\d+)_(.+)/, (ctx) => {
    const prodId = ctx.match[1];
    const target = ctx.match[2];
    db.get("SELECT * FROM products WHERE id = ?", [prodId], (err, prod) => {
        createQRIS(ctx, prod.price_sell, 'PURCHASE', { prod, target });
    });
});

bot.action('topup_saldo', (ctx) => {
    ctx.editMessageText('💰 <b>ISI SALDO</b>\nPilih nominal:', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [Markup.button.callback('10.000', 'depo_10000'), Markup.button.callback('25.000', 'depo_25000')],
                [Markup.button.callback('50.000', 'depo_50000'), Markup.button.callback('100.000', 'depo_100000')],
                [Markup.button.callback('🏠 Batal', 'back_home')]
            ]
        }
    });
});

bot.action(/depo_(\d+)/, (ctx) => createQRIS(ctx, parseInt(ctx.match[1]), 'DEPOSIT', {}));

// Fungsi Utama Generate QRIS
async function createQRIS(ctx, amount, type, data) {
    const userId = ctx.from.id;
    const finalAmount = amount + rand(1, 150); // Kode unik
    const uniqueCode = `trx-${userId}-${Date.now()}`;
    
    try {
        ctx.reply('⏳ <i>Membuat QRIS...</i>', {parse_mode:'HTML'});
        
        const res = await axios.get(`https://api.rajaserverpremium.web.id/orderkuota/createpayment`, {
            params: { apikey: CONFIG.PAYMENT_API_KEY, amount: finalAmount, codeqr: CONFIG.QRIS_STATIC_STRING },
            timeout: 10000
        });

        if (res.data.status !== 'success') throw new Error('API QRIS Error');

        const qrImg = await axios.get(res.data.result.imageqris.url, { responseType: 'arraybuffer' });
        
        const caption = type === 'DEPOSIT' 
            ? `📥 <b>INVOICE DEPOSIT</b>\n💰 Total: <b>${formatRp(finalAmount)}</b>`
            : `🛍️ <b>INVOICE TRANSAKSI</b>\n📦 ${data.prod.name}\n📱 ${data.target}\n💰 Total: <b>${formatRp(finalAmount)}</b>`;

        const msg = await ctx.replyWithPhoto({ source: Buffer.from(qrImg.data) }, {
            caption: caption + `\n\n⚠️ <i>Bayar SESUAI nominal sampai 3 digit terakhir.</i>\n⏳ <i>Otomatis cek 2-5 menit.</i>`,
            parse_mode: 'HTML'
        });

        // Simpan ke Pending
        global.pendingTrx[uniqueCode] = {
            uniqueCode, userId, amount: finalAmount, type, data, 
            timestamp: Date.now(), msgId: msg.message_id
        };

    } catch (e) {
        ctx.reply('❌ Gagal membuat QRIS. Coba lagi.');
    }
}

// ==========================================
// 6. ENGINE PROSES ORDER & REFUND
// ==========================================

async function processOrder(ctx, userId, prod, target, method, paidAmount) {
    bot.telegram.sendMessage(userId, '⏳ <i>Transaksi diproses...</i>', {parse_mode:'HTML'});

    let apiUrl = '';
    // Sesuaikan endpoint API OrderKuota kamu
    if (prod.category === 'XL') apiUrl = 'https://cybersolution.my.id/api/order-xl';
    else apiUrl = 'https://cybersolution.my.id/api/order-indosat';

    try {
        // Payload sesuai contoh user
        const payload = {
            auth_token: CONFIG.OK_TOKEN.split(':')[1], // Ambil token
            auth_username: CONFIG.OK_USERNAME,
            target_number: target,
            voucher_id: prod.code
        };

        const res = await axios.post(apiUrl, payload);

        // Cek sukses (sesuaikan respon API asli)
        if (res.data.success || res.data.status === 'Sukses') {
            const sn = res.data.transaction_details?.sn || 'Sedang Proses';
            bot.telegram.sendMessage(userId, `✅ <b>SUKSES!</b>\n\n📦 ${prod.name}\n📱 ${target}\n🔢 SN: <code>${sn}</code>\n\nTerima kasih!`, {parse_mode:'HTML'});
            
            // Laporan ke Channel
            const profit = prod.price_sell - prod.price_buy;
            bot.telegram.sendMessage(CONFIG.CHANNEL_ID, `🔔 <b>ORDER SUKSES (${method})</b>\nUser: ${userId}\nItem: ${prod.name}\nProfit: ${formatRp(profit)}`, {parse_mode:'HTML'});
        } else {
            throw new Error(res.data.message || 'Gagal');
        }

    } catch (e) {
        // GAGAL & REFUND
        const reason = e.message;
        bot.telegram.sendMessage(userId, `❌ <b>TRANSAKSI GAGAL</b>\nKet: ${reason}\n\n🔄 <i>Dana dikembalikan ke Saldo.</i>`, {parse_mode:'HTML'});
        
        // Kembalikan Saldo (Refund)
        db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [paidAmount, userId]);
    }
}

// ==========================================
// 7. CEK MUTASI OTOMATIS
// ==========================================

async function checkMutation() {
    if (Object.keys(global.pendingTrx).length === 0) return;

    try {
        // Payload Cek Mutasi
        const payload = qs.stringify({
            'username': CONFIG.OK_USERNAME,
            'token': CONFIG.OK_TOKEN,
            'jenis': 'masuk'
        });

        const res = await axios.post('https://orkutapi.andyyuda41.workers.dev/api/qris-history', payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'okhttp/4.12.0' }
        });

        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        const incoming = [];

        // Parsing String Mutasi (Sesuai snippet)
        const blocks = text.split('------------------------');
        blocks.forEach(b => {
            const m = b.match(/Kredit\s*:\s*(?:Rp\s*)?([\d.]+)/i);
            if (m) incoming.push(parseInt(m[1].replace(/\./g, '')));
        });

        // Cocokkan dengan Pending Trx
        for (const [code, trx] of Object.entries(global.pendingTrx)) {
            // Hapus jika expired (10 menit)
            if (Date.now() - trx.timestamp > 10 * 60 * 1000) {
                delete global.pendingTrx[code];
                bot.telegram.deleteMessage(trx.userId, trx.msgId).catch(()=>{});
                continue;
            }

            if (incoming.includes(trx.amount)) {
                // UANG MASUK!
                bot.telegram.deleteMessage(trx.userId, trx.msgId).catch(()=>{});
                delete global.pendingTrx[code];

                if (trx.type === 'DEPOSIT') {
                    db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [trx.amount, trx.userId]);
                    bot.telegram.sendMessage(trx.userId, `✅ <b>DEPOSIT BERHASIL</b>\nSaldo +${formatRp(trx.amount)}`, {parse_mode:'HTML'});
                } else {
                    bot.telegram.sendMessage(trx.userId, `✅ <b>PEMBAYARAN DITERIMA</b>\nMemproses order...`, {parse_mode:'HTML'});
                    processOrder({ telegram: bot.telegram }, trx.userId, trx.data.prod, trx.data.target, 'QRIS', trx.amount);
                }
            }
        }
    } catch (e) {
        // Silent error (supaya tidak spam log console)
    }
}
setInterval(checkMutation, 10000); // Cek setiap 10 detik

// ==========================================
// 8. MENU INFO & PANDUAN
// ==========================================

bot.action('panduan', (ctx) => {
    ctx.editMessageText(`
<b>📚 PANDUAN TRANSAKSI</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>1️⃣ PILIH PRODUK</b>
Masuk menu <b>🛒 Beli Kuota</b> > Pilih Provider > Pilih Paket.

<b>2️⃣ INPUT NOMOR</b>
Masukkan nomor tujuan dengan benar.

<b>3️⃣ METODE BAYAR</b>
• <b>💳 Saldo:</b> Potong saldo akun (Instan).
• <b>⚡ QRIS:</b> Scan QR. Cek otomatis 1-5 menit.

🛡 <b>GARANSI REFUND:</b>
Jika bayar via QRIS tapi transaksi gagal, dana otomatis masuk ke <b>Saldo Bot</b>.`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Kembali', 'back_home')]] }
    });
});

bot.action('info_bot', (ctx) => {
    ctx.editMessageText(`
<b>ℹ️ INFORMASI BOT</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 <b>WINTUNELING VPN BOT</b>
@wintunelingvpnBot

⚡ <b>WINTUNELING ZIVPN</b>
@wintunelingzivpnBot

Kami menyediakan layanan Topup Kuota & VPN Premium (SSH/V2Ray/UDP) dengan harga termurah dan server stabil.

📢 <b>Channel:</b> @WINTUNELINGVPNN
`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Kembali', 'back_home')]] }
    });
});

bot.action('contact', (ctx) => {
    ctx.editMessageText(`📞 <b>ADMIN SUPPORT</b>\nJika ada kendala, hubungi: @WINTUNELINGVPNN`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Kembali', 'back_home')]] }
    });
});


// Start Bot
bot.launch().then(() => console.log('✅ Bot WINTUNELING Berjalan!'));

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
