require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// Inisialisasi Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Inisialisasi Discord Client
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

client.once('ready', async () => {
    console.log(`Bot login sebagai ${client.user.tag}`);
    
    const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    if (!guild) {
        console.error("Gagal menemukan Server Discord!");
        process.exit();
    }

    try {
        // --- 1. FITUR SINKRONISASI ---
        console.log("Memulai sinkronisasi member...");
        const members = await guild.members.fetch();
        const dataToUpsert = [];
        const activeDiscordIds = [];

        // Gunakan for...of untuk mendukung await di dalam loop
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

                // Sinkronisasi data ke tabel logs (absensi_sasg)
                // Mengupdate semua baris yang sudah ada tanpa menambah data baru (mencegah duplikat)
                await supabase
                    .from('absensi_sasg')
                    .update({
                        nama_anggota: freshName,
                        pangkat: userPangkat,
                        divisi: userDivisi
                    })
                    .eq('discord_id', member.id);

                dataToUpsert.push({
                    discord_id: member.id,
                    nama_anggota: freshName,
                    pangkat: userPangkat,
                    divisi: userDivisi,
                    last_login: new Date().toISOString()
                });
            }
        }

        // HAPUS member yang keluar (Fitur users_master tetap sesuai aslinya)
        if (activeDiscordIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('users_master')
                .delete()
                .not('discord_id', 'in', `(${activeDiscordIds.join(',')})`);
            
            if (deleteError) console.error("Gagal menghapus member keluar:", deleteError.message);
        }

        // UPDATE atau TAMBAH ke users_master
        const { error: upsertError } = await supabase
            .from('users_master')
            .upsert(dataToUpsert, { onConflict: 'discord_id' });

        if (upsertError) throw upsertError;
        console.log("Sinkronisasi Berhasil! Database profil & riwayat absen terupdate.");

        // --- 2. FITUR BROADCAST (WIB) ---
        const sekarang = new Date();
        const waktuWIB = new Date(sekarang.getTime() + (7 * 60 * 60 * 1000));
        const jam = waktuWIB.getUTCHours().toString().padStart(2, '0');
        const menit = waktuWIB.getUTCMinutes();
        const waktuString = `${jam}:${menit.toString().padStart(2, '0')}`;

        console.log(`Waktu saat ini (WIB): ${waktuString}`);

        const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
        
        if (channel) {
            if (jam === "19" && (menit >= 30 && menit <= 59)) { 
                await channel.send("📢 **PENGUMUMAN DUTY**\nWAKTUNYA DUTY JIKA BERHALANGAN SILAHKAN IZIN ATAU CUTI DI https://exsg.netlify.app/\n\n@everyone");
                console.log("Pesan 19:30 terkirim.");
            } 
            else if (jam === "22" && (menit >= 0 && menit <= 59)) {
                await channel.send("📢 **REMINDER ABSENSI**\nJANGAN LUPA UNTUK MENGISI KEHADIRAN DI https://exsg.netlify.app/\n\n@everyone");
                console.log("Pesan 22:00 terkirim.");
            }
        }

    } catch (err) {
        console.error("Terjadi kesalahan:", err.message);
    } finally {
        setTimeout(() => process.exit(), 5000);
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);