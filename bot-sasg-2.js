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


// --- FUNGSI TAMBAHAN: CEK ABSENSI ---
async function checkMissingAbsence(channel) {
    try {
        // Ambil semua user dari master
        const { data: allUsers, error: errUsers } = await supabase.from('users_master').select('discord_id');
        if (errUsers) throw errUsers;

        // Ambil data absen hari ini (WIB)
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const { data: attendedToday, error: errAbsen } = await supabase
            .from('absensi_sasg')
            .select('discord_id')
            .gte('created_at', startOfDay.toISOString());

        if (errAbsen) throw errAbsen;

        const attendedIds = attendedToday.map(u => u.discord_id);
        const slackingUsers = allUsers.filter(u => !attendedIds.includes(u.discord_id));

        if (slackingUsers.length > 0) {
            const mentions = slackingUsers.map(u => `<@${u.discord_id}>`).join(' ');
            await channel.send(`⚠️ **REMINDER**\nAnggota berikut belum melakukan absensi hari ini:\n${mentions}\n\nSegera lakukan absensi di: https://san-andreas-police-departement.netlify.app/\n@everyona`);
        } else {
            await channel.send("✅ **REMINDER**: Semua anggota sudah melakukan absensi.\n@everyone");
        }
    } catch (err) {
        console.error("Gagal melakukan pengecekan absensi:", err.message);
    }
}

// 4. FUNGSI UTAMA PENGECEKAN
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

        // --- BROADCAST & REMINDER (WIB) ---
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
        const jam = now.getHours();
        const menit = now.getMinutes();

        const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
        if (channel) {
            // Hanya aktif di jam 19:00 - 23:59
            if (jam >= 19 && jam <= 23) {
                
                // Jika tepat jam 19:00 - 19:10 (Awal Tugas)
                if (jam === 19 && menit <= 10) {
                    await channel.send("📢 **REMINDER **\nWaktunya duty teman teman , jika anda memiliki kesibukan/sedang sakit silahkan ajukan izin dan cuti\nJika Cuti / Izin anda dianggap melewati batas(keseringan) maka anda akan di sp atau bahkan dikeluarkan\nLink Daftar Hadir: https://san-andreas-police-departement.netlify.app/\@everyone");
                    await checkMissingAbsence(channel); // Langsung cek & tag orang saat itu juga
                } 
                
                // Reminder tambahan jam 22:00
                else if (jam === 22 && menit <= 10) {
                    await channel.send("📢 **REMINDER **\nJangan lupa mengisi kehadiran sebelum hari berganti.\nLink Daftar Hadir : https://san-andreas-police-departement.netlify.app/\@everyone");
                    await checkMissingAbsence(channel);
                }
            }
        }
    } catch (err) {
        console.error("Terjadi kesalahan:", err.message);
    }
}

client.once('ready', () => {
    console.log(`Bot Pengecek SASG aktif sebagai ${client.user.tag}`);
    runSasgTask();
    setInterval(runSasgTask, 600000); // Interval 10 menit
});

process.on('SIGTERM', () => {
    console.log("Bot dimatikan oleh sistem.");
    process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
