require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// 1. INISIALISASI KONEKSI
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages
    ] 
});

// Mapping Pangkat
const PANGKAT_MAP = {
    "1391976318366650410": "GUBERUR",
    "1391976320266801343": "WAKIL GUBERNUR",
    "1391976322154365018": "SEKRETARIS",
    "1391976325958471710": "KEPALA DIVISI",
    "1391976330014232597": "STAFF SENIOR",
    "1492398501685104740": "STAFF JUNIOR",
    "1492398633679585393": "STAFF MAGANG"
};

const DIVISI_MAP = {
    "1444921188215165141": "HIGHWAY PATROL",
    "1444920955620032533": "RAMPART DIVISION",
    "1444920880370159617": "METROPOLITAN",
    "1444908272363769887": "HUMAN RESOURCE BUREAU",
    "1444921352120434819": "INTERNAL AFFAIRS DIVISION"
};

// ID Channel untuk pengumuman
const ANNOUNCEMENT_CHANNEL_ID = "1492401243476197376"; 
const REQUIRED_ROLE_ID = "1492398964610170940";
const ADMIN_ROLE_ID = "1492400977012068363"; // CONTOH: ID Role Chief (Sesuaikan dengan ID Role Admin/High Command kamu)

// FUNGSI UTAMA PENGECEKAN
async function runSasgTask() {
    console.log(`[${new Date().toLocaleString('id-ID')}] Memulai tugas rutin SASG...`);
    
    const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    if (!guild) return console.error("Error: Server Discord tidak ditemukan!");

    try {
        // --- SINKRONISASI DATA ---
        const members = await guild.members.fetch();
        const dataToUpsert = [];
        const activeDiscordIds = [];
        const updateTasks = [];

        for (const [id, member] of members) {
            if (member.roles.cache.has(REQUIRED_ROLE_ID)) {
                let userPangkat = "-";
                let userDivisi = "-";

                member.roles.cache.forEach(role => {
                    if (PANGKAT_MAP[role.id]) userPangkat = PANGKAT_MAP[role.id];
                    if (DIVISI_MAP[role.id]) userDivisi = DIVISI_MAP[role.id];
                });

                const freshName = member.nickname || member.user.globalName || member.user.username;
                activeDiscordIds.push(member.id);
                const isUserAdmin = member.roles.cache.has(ADMIN_ROLE_ID);

                updateTasks.push(
                    supabase.from('absensi_sasg').update({
                        nama_anggota: freshName,
                        pangkat: userPangkat,
                        divisi: userDivisi
                    }).eq('discord_id', member.id)
                );

                dataToUpsert.push({
                    discord_id: member.id,
                    nama_anggota: freshName,
                    pangkat: userPangkat,
                    divisi: userDivisi,
                    is_admin: isUserAdmin, 
                    last_login: new Date().toISOString()
                });
            }
        }

        await Promise.all(updateTasks);

        if (activeDiscordIds.length > 0) {
            await supabase.from('users_master').delete().not('discord_id', 'in', `(${activeDiscordIds.join(',')})`);
        }

        const { error: upsertError } = await supabase.from('users_master').upsert(dataToUpsert, { onConflict: 'discord_id' });
        if (upsertError) throw upsertError;
        console.log("Sinkronisasi Berhasil.");

        // --- BROADCAST PENGUMUMAN (WIB) ---
        const formatter = new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta', hour: 'numeric', minute: 'numeric', hour12: false
        });
        
        const formattedDate = formatter.format(new Date());
        const [jamStr, menitStr] = formattedDate.replace('.', ':').split(':');
        const jam = parseInt(jamStr);
        const menit = parseInt(menitStr);

        const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
        if (channel) {
            // Cek jika jam 19:30 - 19:40 (dibatasi agar tidak spam setiap menit dalam jam tersebut)
            if (jam === 19 && menit >= 30 && menit <= 40) { 
                await channel.send("📢 **PENGUMUMAN DUTY**\nWAKTUNYA DUTY JIKA BERHALANGAN SILAHKAN IZIN ATAU CUTI DI https://exsg.netlify.app/\n\n@everyone");
            } 
            else if (jam === 22 && menit <= 10) {
                await channel.send("📢 **REMINDER ABSENSI**\nJANGAN LUPA UNTUK MENGISI KEHADIRAN DI https://exsg.netlify.app/\n\n@everyone");
            }
        }
    } catch (err) {
        console.error("Terjadi kesalahan:", err.message);
    }
}

client.once('ready', () => {
    console.log(`Bot Pengecek SASG aktif sebagai ${client.user.tag}`);
    
    // Jalankan tugas pertama kali saat bot nyala
    runSasgTask();

    // Jalankan tugas SETIAP 10 MENIT selama bot standby (6 jam)
    setInterval(() => {
        runSasgTask();
    }, 600000); // 600.000 ms = 10 menit
});

// Menangkap sinyal berhenti agar tidak error di log
process.on('SIGTERM', () => {
    console.log("Bot dimatikan oleh sistem.");
    process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);