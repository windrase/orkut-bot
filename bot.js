/*
  🔥 WINTUNELING STORE BOT (FINAL PRODUCTION CODE)
  Features: Direct QRIS, Wallet System, Auto Refund, Admin Panel
*/

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const qs = require('qs');

// ============================================================
// 1. KONFIGURASI PENTING (ISI DATA DISINI)
// ============================================================
const CONFIG = {
    // 🤖 Token Bot dari BotFather
    BOT_TOKEN: '8437818788:AAEkujLT_c-euE5gHVruvF8ceOcH-cruw0c', 

    // 👤 ID Telegram Admin (Supaya bisa tambah produk)
    ADMIN_ID: 6047772290, 

    // 📢 ID Channel Notifikasi Transaksi (Awalan -100)
    CHANNEL_ID: '-1002727126984', 

    // 🌐 Data Akun OrderKuota / CyberSolution
    OK_USERNAME: 'allufi', 
    OK_TOKEN: '1991647:0jkip97VR6huEtrc2XvWUDsOBY5yFMxA', 

    // 💳 Data QRIS (String Statis dari NURIS/OrderKuota)
    QRIS_STATIC_STRING: '00020101021126670016COM.NOBUBANK.WWW01189360050300000879140214052524280562170303UMI51440014ID.CO.QRIS.WWW0215ID20243395055030303UMI5204481253033605802ID5919HABS CELL OK19916476015JAKARTA SELATAN61051211062070703A0163045BB5', 

    // 🔑 API Key RajaServer (Untuk generate QRIS dinamis)
    PAYMENT_API_KEY: 'AriApiPaymetGetwayMod' 
};

// ============================================================
// 2. DATABASE & SYSTEM INIT
// ============================================================
const bot = new Telegraf(CONFIG.BOT_TOKEN);
const db = new sqlite3.Database('wintuneling.db');

// Variable Global Sementara
const globalState = {}; 
global.pendingTrx = {}; // Menyimpan transaksi pending menunggu pembayaran

// Inisialisasi Tabel Database
db.serialize(() => {
    // Tabel User: ID, Saldo, Nama
    db.run("CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, saldo INTEGER DEFAULT 0, name TEXT)");
    // Tabel Produk: Kode, Nama, Kategori, Harga Beli, Harga Jual
    db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT, category TEXT, price_buy INTEGER, price_sell INTEGER)");
});

// Helper: Format Rupiah & Random Angka Unik
const formatRp = (angka) => 'Rp ' + parseInt(angka).toLocaleString('id-ID');
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

// ============================================================
// 3. ADMIN PANEL (MANAJEMEN PRODUK)
// ============================================================

// Command: /admin
bot.command('admin', (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    ctx.reply('🔧 <b>ADMIN DASHBOARD</b>', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [Markup.button.callback('➕ Tambah Produk Baru', 'adm_add')],
                [Markup.button.callback('📜 Lihat Daftar Produk', 'adm_list')] // Fitur view list bisa dikembangkan
            ]
        }
    });
});

// Wizard Tambah Produk
bot.action('adm_add', (ctx) => {
    globalState[ctx.from.id] = { step: 'INPUT_CODE' };
    ctx.reply('➡️ Masukkan <b>KODE PRODUK</b> dari API (Contoh: XLD10):', {parse_mode:'HTML'});
});

// Handler Text Global (Untuk Admin & User Input Nomor)
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = globalState[userId];
    const text = ctx.message.text;

    // --- LOGIKA ADMIN TAMBAH PRODUK ---
    if (state && userId === CONFIG.ADMIN_ID && state.step) {
        if (state.step === 'INPUT_CODE') {
            state.code = text;
            state.step = 'INPUT_NAME';
            return ctx.reply('➡️ Masukkan <b>NAMA TAMPILAN</b> (Contoh: XL 10GB 30H):', {parse_mode:'HTML'});
        }
        if (state.step === 'INPUT_NAME') {
            state.name = text;
            state.step = 'INPUT_CAT';
            return ctx.reply('➡️ Masukkan <b>KATEGORI</b> (Ketik: XL atau INDOSAT):');
        }
        if (state.step === 'INPUT_CAT') {
            state.category = text.toUpperCase();
            state.step = 'INPUT_BUY';
            return ctx.reply('➡️ Masukkan <b>HARGA BELI</b> (Harga Modal):');
        }
        if (state.step === 'INPUT_BUY') {
            state.price_buy = parseInt(text);
            state.step = 'INPUT_SELL';
            return ctx.reply('➡️ Masukkan <b>HARGA JUAL</b> (Harga ke User):');
        }
        if (state.step === 'INPUT_SELL') {
            const priceSell = parseInt(text);
            db.run("INSERT INTO products (code, name, category, price_buy, price_sell) VALUES (?,?,?,?,?)", 
                [state.code, state.name, state.category, state.price_buy, priceSell], (err) => {
                    if(err) ctx.reply('❌ Gagal Database.');
                    else ctx.reply(`✅ <b>PRODUK DISIMPAN!</b>\n${state.name}\nBeli: ${state.price_buy}\nJual: ${priceSell}`, {parse_mode:'HTML'});
                });
            delete globalState[userId];
            return;
        }
    }

    // --- LOGIKA USER INPUT NOMOR ---
    if (state && state.mode === 'INPUT_NUMBER') {
        const target = text.replace(/[^0-9]/g, ''); // Hanya ambil angka
        if (target.length < 9) return ctx.reply('⚠️ Nomor tidak valid. Silahkan ketik ulang.');
        
        const prod = state.product;
        
        // Tampilan Konfirmasi (Struk Text)
        const msg = `
🧾 <b>KONFIRMASI PEMBELIAN</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 <b>Produk:</b> ${prod.name}
🏷 <b>Kategori:</b> ${prod.category}
📱 <b>Tujuan:</b> <code>${target}</code>
💸 <b>Harga:</b> ${formatRp(prod.price_sell)}
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>Silahkan pilih metode pembayaran:</i>`;
        
        ctx.reply(msg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback(`💳 Saldo (${formatRp(prod.price_sell)})`, `pay_saldo_${prod.id}_${target}`)],
                    [Markup.button.callback(`⚡ QRIS (Bayar Langsung)`, `pay_qris_${prod.id}_${target}`)],
                    [Markup.button.callback('❌ Batal', 'back_home')]
                ]
            }
        });
        delete globalState[userId]; // Hapus state agar tidak loop
        return;
    }

    next();
});

// ============================================================
// 4. USER INTERFACE (MENU UTAMA & NAVIGASI)
// ============================================================

bot.start((ctx) => {
    db.get("SELECT * FROM users WHERE user_id = ?", [ctx.from.id], (err, row) => {
        // Jika user baru, masukkan ke DB
        if (!row) db.run("INSERT INTO users (user_id, name) VALUES (?,?)", [ctx.from.id, ctx.from.first_name]);
        
        const saldo = row ? row.saldo : 0;
        const name = ctx.from.first_name.replace(/</g, ''); // Sanitasi nama

        const text = `
🔥 <b>WINTUNELING STORE</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👋 <b>Halo, ${name}!</b>
Selamat datang di bot topup otomatis 24 Jam.

📊 <b>INFO PENGGUNA</b>
🆔 ID: <code>${ctx.from.id}</code>
💰 Saldo: <b>${formatRp(saldo)}</b>
⚜️ Status: <b>Member Basic</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>👇 Silahkan pilih menu transaksi:</i>`;

        // Gunakan reply biasa agar selalu jadi pesan baru saat start
        ctx.reply(text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🛒 Beli Kuota', 'menu_beli'), Markup.button.callback('💳 Isi Saldo', 'topup_saldo')],
                    [Markup.button.callback('📚 Panduan', 'panduan'), Markup.button.callback('ℹ️ Info Bot', 'info_bot')]
                ]
            }
        });
    });
});

// Tombol Kembali ke Menu Utama
bot.action('back_home', (ctx) => {
    ctx.deleteMessage().catch(()=>{});
    // Trigger manual pesan start
    const userId = ctx.from.id;
    db.get("SELECT saldo FROM users WHERE user_id = ?", [userId], (err, row) => {
        const saldo = row ? row.saldo : 0;
        const text = `🔥 <b>WINTUNELING STORE</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👋 Halo!\n💰 Saldo: <b>${formatRp(saldo)}</b>\n\n<i>Silahkan pilih menu:</i>`;
        ctx.reply(text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🛒 Beli Kuota', 'menu_beli'), Markup.button.callback('💳 Isi Saldo', 'topup_saldo')],
                    [Markup.button.callback('📚 Panduan', 'panduan'), Markup.button.callback('ℹ️ Info Bot', 'info_bot')]
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
Silahkan pilih operator seluler tujuan Anda:`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [Markup.button.callback('🔵 XL Axiata', 'list_XL'), Markup.button.callback('🟡 Indosat', 'list_INDOSAT')],
                [Markup.button.callback('🔙 Kembali Utama', 'back_home')]
            ]
        }
    }).catch(()=>{}); // Catch error jika message expired
});

// List Produk (Grid 2 Kolom)
bot.action(/list_(.+)/, (ctx) => {
    const cat = ctx.match[1];
    let header = cat === 'XL' ? '🔵 <b>XL AXIATA</b>' : '🟡 <b>INDOSAT OOREDOO</b>';

    db.all("SELECT * FROM products WHERE category = ?", [cat], (err, rows) => {
        if (!rows || rows.length === 0) return ctx.answerCbQuery('⚠️ Produk kosong / belum tersedia.', {show_alert:true});
        
        const buttons = [];
        let tempRow = [];
        
        rows.forEach((p) => {
            // Tampilan: "Nama Paket • 15rb"
            const priceK = (p.price_sell / 1000) + 'rb'; 
            tempRow.push(Markup.button.callback(`${p.name} • ${priceK}`, `buy_prod_${p.id}`));

            if (tempRow.length === 2) { // Max 2 tombol per baris
                buttons.push(tempRow);
                tempRow = [];
            }
        });
        if (tempRow.length > 0) buttons.push(tempRow);
        
        buttons.push([Markup.button.callback('🔙 Ganti Provider', 'menu_beli')]);

        ctx.editMessageText(`${header}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nPilih paket yang tersedia:`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
        }).catch(()=>{});
    });
});

// Trigger saat produk dipilih -> Minta Input Nomor
bot.action(/buy_prod_(\d+)/, (ctx) => {
    const prodId = ctx.match[1];
    db.get("SELECT * FROM products WHERE id = ?", [prodId], (err, row) => {
        globalState[ctx.from.id] = { mode: 'INPUT_NUMBER', product: row };
        ctx.editMessageText(`
📝 <b>INPUT NOMOR TUJUAN</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 <b>${row.name}</b>
💸 <b>${formatRp(row.price_sell)}</b>

<i>Silahkan ketik nomor HP tujuan (Awalan 08xxx):</i>`, {parse_mode: 'HTML'});
    });
});

// ============================================================
// 5. SISTEM PEMBAYARAN (QRIS & SALDO)
// ============================================================

// A. Bayar Pakai SALDO
bot.action(/pay_saldo_(\d+)_(.+)/, (ctx) => {
    const prodId = ctx.match[1];
    const target = ctx.match[2];
    const userId = ctx.from.id;

    db.get("SELECT saldo FROM users WHERE user_id = ?", [userId], (err, user) => {
        db.get("SELECT * FROM products WHERE id = ?", [prodId], (err, prod) => {
            if (user.saldo < prod.price_sell) return ctx.answerCbQuery('❌ Saldo tidak cukup! Silahkan Topup dulu.', { show_alert: true });

            // 1. Potong Saldo User
            db.run("UPDATE users SET saldo = saldo - ? WHERE user_id = ?", [prod.price_sell, userId]);
            
            // 2. Eksekusi Order ke Pusat
            ctx.deleteMessage().catch(()=>{});
            processOrder(ctx.telegram, userId, prod, target, 'SALDO', prod.price_sell);
        });
    });
});

// B. Bayar Pakai QRIS (Langsung)
bot.action(/pay_qris_(\d+)_(.+)/, (ctx) => {
    const prodId = ctx.match[1];
    const target = ctx.match[2];
    // Ambil detail produk lalu generate QRIS
    db.get("SELECT * FROM products WHERE id = ?", [prodId], (err, prod) => {
        createQRIS(ctx, prod.price_sell, 'PURCHASE', { prod, target });
    });
});

// C. Menu Topup Saldo
bot.action('topup_saldo', (ctx) => {
    ctx.editMessageText('💰 <b>ISI SALDO OTOMATIS</b>\nSilahkan pilih nominal deposit:', {
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

// --- FUNGSI GENERATE QRIS ---
async function createQRIS(ctx, amount, type, data) {
    const userId = ctx.from.id;
    const finalAmount = amount + rand(1, 150); // Tambah kode unik 3 digit
    const uniqueCode = `trx-${userId}-${Date.now()}`;
    
    try {
        ctx.reply('⏳ <i>Sedang membuat QRIS...</i>', {parse_mode:'HTML'});
        
        // Request ke API Payment Gateway
        const res = await axios.get(`https://api.rajaserverpremium.web.id/orderkuota/createpayment`, {
            params: { apikey: CONFIG.PAYMENT_API_KEY, amount: finalAmount, codeqr: CONFIG.QRIS_STATIC_STRING },
            timeout: 10000
        });

        if (res.data.status !== 'success') throw new Error('API QRIS Error');

        const qrImg = await axios.get(res.data.result.imageqris.url, { responseType: 'arraybuffer' });
        
        let caption = '';
        if (type === 'DEPOSIT') {
            caption = `📥 <b>INVOICE DEPOSIT</b>\n━━━━━━━━━━━━━━━━\n💰 Total: <b>${formatRp(finalAmount)}</b>\n⏳ Expired: 5 Menit`;
        } else {
            caption = `🛍️ <b>INVOICE TRANSAKSI</b>\n━━━━━━━━━━━━━━━━\n📦 Produk: ${data.prod.name}\n📱 Tujuan: ${data.target}\n💰 Total: <b>${formatRp(finalAmount)}</b>`;
        }

        const msg = await ctx.replyWithPhoto({ source: Buffer.from(qrImg.data) }, {
            caption: caption + `\n\n⚠️ <i>Bayar HARUS PERSIS nominal diatas (termasuk 3 digit terakhir).</i>\n✅ <i>Sistem cek otomatis 1-5 menit.</i>`,
            parse_mode: 'HTML'
        });

        // Simpan Transaksi ke Memori (Pending)
        global.pendingTrx[uniqueCode] = {
            uniqueCode, userId, amount: finalAmount, type, data, 
            timestamp: Date.now(), msgId: msg.message_id
        };

    } catch (e) {
        console.error(e);
        ctx.reply('❌ Gagal membuat QRIS. Silahkan coba lagi nanti.');
    }
}

// ============================================================
// 6. ENGINE PROSES ORDER & REFUND SYSTEM
// ============================================================

async function processOrder(telegram, userId, prod, target, method, paidAmount) {
    telegram.sendMessage(userId, '⏳ <i>Sedang memproses transaksi...</i>', {parse_mode:'HTML'});

    // Tentukan URL berdasarkan kategori produk
    let apiUrl = '';
    if (prod.category === 'XL') apiUrl = 'https://cybersolution.my.id/api/order-xl';
    else apiUrl = 'https://cybersolution.my.id/api/order-indosat';

    try {
        // Payload API
        const payload = {
            auth_token: CONFIG.OK_TOKEN.split(':')[1] || CONFIG.OK_TOKEN, // Handle format token
            auth_username: CONFIG.OK_USERNAME,
            target_number: target,
            voucher_id: prod.code
        };

        const res = await axios.post(apiUrl, payload);

        // Cek Respon Sukses
        if (res.data.success || res.data.status === 'Sukses') {
            const sn = res.data.transaction_details?.sn || 'Sedang Proses';
            
            // 1. Notif User Sukses
            telegram.sendMessage(userId, `✅ <b>TRANSAKSI SUKSES!</b>\n\n📦 ${prod.name}\n📱 ${target}\n🔢 SN: <code>${sn}</code>\n\nTerima kasih sudah belanja!`, {parse_mode:'HTML'});
            
            // 2. Laporan ke Channel Admin
            const profit = prod.price_sell - prod.price_buy;
            telegram.sendMessage(CONFIG.CHANNEL_ID, `🔔 <b>ORDER SUKSES (${method})</b>\n👤 User: ${userId}\n📦 Item: ${prod.name}\n💰 Profit: ${formatRp(profit)}`, {parse_mode:'HTML'});

        } else {
            throw new Error(res.data.message || 'Gagal dari Pusat');
        }

    } catch (e) {
        // --- AUTO REFUND SYSTEM ---
        const reason = e.message;
        telegram.sendMessage(userId, `❌ <b>TRANSAKSI GAGAL</b>\nKet: ${reason}\n\n🔄 <i>Dana otomatis dikembalikan ke Saldo Bot.</i>`, {parse_mode:'HTML'});
        
        // Kembalikan Uang ke Saldo User
        db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [paidAmount, userId]);
    }
}

// ============================================================
// 7. CEK MUTASI OTOMATIS (POLLING)
// ============================================================

async function checkMutation() {
    // Jika tidak ada transaksi pending, skip biar hemat resource
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

        // Parsing String Mutasi
        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        const incoming = [];
        const blocks = text.split('------------------------');
        blocks.forEach(b => {
            const m = b.match(/Kredit\s*:\s*(?:Rp\s*)?([\d.]+)/i);
            if (m) incoming.push(parseInt(m[1].replace(/\./g, '')));
        });

        // Loop Transaksi Pending
        for (const [code, trx] of Object.entries(global.pendingTrx)) {
            // Hapus trx expired (lebih dari 10 menit)
            if (Date.now() - trx.timestamp > 10 * 60 * 1000) {
                delete global.pendingTrx[code];
                bot.telegram.deleteMessage(trx.userId, trx.msgId).catch(()=>{});
                continue;
            }

            // Jika Nominal Ditemukan di Mutasi
            if (incoming.includes(trx.amount)) {
                // Hapus Pesan QRIS & Data Pending
                bot.telegram.deleteMessage(trx.userId, trx.msgId).catch(()=>{});
                delete global.pendingTrx[code];

                if (trx.type === 'DEPOSIT') {
                    // Jika Deposit -> Tambah Saldo
                    db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [trx.amount, trx.userId]);
                    bot.telegram.sendMessage(trx.userId, `✅ <b>DEPOSIT BERHASIL</b>\nSaldo ditambahkan: ${formatRp(trx.amount)}`, {parse_mode:'HTML'});
                    bot.telegram.sendMessage(CONFIG.CHANNEL_ID, `💰 <b>DEPOSIT MASUK</b>\nUser: ${trx.userId}\nJumlah: ${formatRp(trx.amount)}`, {parse_mode:'HTML'});
                } else {
                    // Jika Pembelian -> Proses Order
                    bot.telegram.sendMessage(trx.userId, `✅ <b>PEMBAYARAN DITERIMA</b>\nMemproses order...`, {parse_mode:'HTML'});
                    processOrder(bot.telegram, trx.userId, trx.data.prod, trx.data.target, 'QRIS', trx.amount);
                }
            }
        }
    } catch (e) {
        // Silent error agar tidak spam log console jika API down sebentar
    }
}
// Jalankan Cek Mutasi setiap 10 detik
setInterval(checkMutation, 10000);

// ============================================================
// 8. MENU INFO & PANDUAN
// ============================================================

bot.action('panduan', (ctx) => {
    ctx.editMessageText(`
<b>📚 PANDUAN TRANSAKSI</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>1️⃣ PILIH PRODUK</b>
Klik menu <b>🛒 Beli Kuota</b> > Pilih Provider > Pilih Paket.

<b>2️⃣ INPUT NOMOR</b>
Masukkan nomor tujuan dengan benar.

<b>3️⃣ METODE BAYAR</b>
• <b>💳 Saldo:</b> Potong saldo akun (Instan).
• <b>⚡ QRIS:</b> Scan QR. Cek otomatis 1-5 menit.

🛡 <b>GARANSI REFUND:</b>
Jika bayar via QRIS tapi transaksi gagal (gangguan), dana otomatis masuk ke <b>Saldo Bot</b>.`, {
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

Kami menyediakan layanan Topup Kuota & VPN Premium (SSH/V2Ray/UDP) dengan harga termurah.

📢 <b>Channel:</b> @WINTUNELINGVPNN
`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Kembali', 'back_home')]] }
    });
});

// START BOT
bot.launch().then(() => {
    console.log('✅ Bot WINTUNELING Berhasil Dijalankan!');
    console.log('➡️ Silahkan chat bot di Telegram.');
});

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
