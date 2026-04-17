require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
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

// ID Channel untuk pengumuman dan logs (DEFINISI MANUAL)
const ANNOUNCEMENT_CHANNEL_ID = "1492401243476197376"; 
const LOG_CHANNEL_ID = "1494352421294444595"; // Forum Channel ID
const REQUIRED_ROLE_ID = "1492398964610170940";
const ADMIN_ROLE_ID = "1492400977012068363";
const DISCORD_GUILD_ID = "1391854057487863998";

// ===== FUNGSI LOGGING UNTUK FORUM CHANNEL =====
async function sendLog(message, type = 'info') {
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        
        // Validasi adalah forum channel
        if (!channel || channel.type !== ChannelType.GuildForum) {
            console.warn("⚠️ Channel logs bukan forum channel!");
            return;
        }

        const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const emoji = type === 'delete' ? '🗑️' : type === 'warning' ? '⚠️' : 'ℹ️';
        const title = `${emoji} [${timestamp}] Bot Log`;
        const content = message;

        // Buat thread baru di forum
        const thread = await channel.threads.create({
            name: title,
            message: {
                content: content
            }
        });

        console.log(`📤 Log dikirim ke forum: ${title}`);
    } catch (err) {
        console.error("❌ Gagal mengirim log:", err.message);
    }
}

// ===== FUNGSI PENGECEKAN & PENGHAPUSAN DATA =====
/**
 * Menghapus data user ketika user tidak memiliki required role
 */
async function checkAndDeleteUserWithoutRequiredRole(guild) {
    console.log("🔍 Memeriksa users tanpa required role...");
    
    try {
        const { data: allUsers, error: fetchError } = await supabase
            .from('users_master')
            .select('discord_id, nama_anggota');
        
        if (fetchError) throw fetchError;
        if (!allUsers || allUsers.length === 0) {
            console.log("ℹ️ Tidak ada users di database.");
            return;
        }
        
        const members = await guild.members.fetch();
        let deletedCount = 0;

        for (const user of allUsers) {
            const member = members.get(user.discord_id);
            
            // Jika member tidak ditemukan atau tidak memiliki required role
            if (!member || !member.roles.cache.has(REQUIRED_ROLE_ID)) {
                // Hapus dari users_master
                const { error: userError } = await supabase
                    .from('users_master')
                    .delete()
                    .eq('discord_id', user.discord_id);
                
                // Hapus dari absensi_sasg
                const { error: absensiError } = await supabase
                    .from('absensi_sasg')
                    .delete()
                    .eq('discord_id', user.discord_id);
                
                if (userError || absensiError) {
                    console.error(`❌ Error menghapus user ${user.nama_anggota}:`, userError?.message || absensiError?.message);
                    continue;
                }
                
                deletedCount++;
                const reason = !member ? "User tidak ada di Discord" : "Tidak memiliki required role";
                await sendLog(
                    `Dihapus: **${user.nama_anggota}** (${user.discord_id}) - ${reason}`,
                    'delete'
                );
                console.log(`✓ Dihapus: ${user.nama_anggota}`);
            }
        }

        if (deletedCount > 0) {
            console.log(`✓ Total dihapus: ${deletedCount} users`);
        } else {
            console.log("ℹ️ Tidak ada users yang perlu dihapus.");
        }
    } catch (err) {
        console.error("❌ Error saat checking users:", err.message);
        await sendLog(`❌ Error pengecekan users: ${err.message}`, 'warning');
    }
}

/**
 * Menghapus data orphaned di absensi_sasg
 */
async function cleanupOrphanedAttendanceData(guild) {
    console.log("🔍 Membersihkan data orphaned di absensi_sasg...");
    
    try {
        const members = await guild.members.fetch();
        const { data: allAttendance, error: fetchError } = await supabase
            .from('absensi_sasg')
            .select('discord_id, nama_anggota');
        
        if (fetchError) throw fetchError;
        if (!allAttendance || allAttendance.length === 0) {
            console.log("ℹ️ Tidak ada data absensi.");
            return;
        }

        const { data: allUsers, error: usersError } = await supabase
            .from('users_master')
            .select('discord_id');
        
        if (usersError) throw usersError;

        const validUserIds = allUsers.map(u => u.discord_id);
        let orphanedCount = 0;

        for (const attendance of allAttendance) {
            const userExists = validUserIds.includes(attendance.discord_id);
            const memberInDiscord = members.has(attendance.discord_id);
            const hasRequiredRole = memberInDiscord && members.get(attendance.discord_id).roles.cache.has(REQUIRED_ROLE_ID);

            // Hapus jika: user tidak ada di users_master ATAU member tidak ada di Discord ATAU tidak punya required role
            if (!userExists || !memberInDiscord || !hasRequiredRole) {
                const { error: deleteError } = await supabase
                    .from('absensi_sasg')
                    .delete()
                    .eq('discord_id', attendance.discord_id);
                
                if (deleteError) {
                    console.error(`❌ Error menghapus orphaned data ${attendance.nama_anggota}:`, deleteError.message);
                    continue;
                }
                
                orphanedCount++;
                const reason = !userExists ? "User tidak di master" : 
                             !memberInDiscord ? "User tidak di Discord" : 
                             "Tidak punya required role";
                
                await sendLog(
                    `Orphaned dihapus: **${attendance.nama_anggota}** (${attendance.discord_id}) - ${reason}`,
                    'delete'
                );
                console.log(`✓ Dihapus orphaned: ${attendance.nama_anggota}`);
            }
        }

        if (orphanedCount > 0) {
            console.log(`✓ Total orphaned dihapus: ${orphanedCount}`);
        } else {
            console.log("ℹ️ Tidak ada orphaned data.");
        }
    } catch (err) {
        console.error("❌ Error cleanup orphaned:", err.message);
        await sendLog(`❌ Error cleanup: ${err.message}`, 'warning');
    }
}

// ===== FUNGSI UTAMA PENGECEKAN =====
async function runSasgTask() {
    console.log(`\n[${new Date().toLocaleString('id-ID')}] Memulai tugas rutin SASG...`);
    
    const guild = client.guilds.cache.get(DISCORD_GUILD_ID);
    if (!guild) {
        console.error("❌ Error: Server Discord tidak ditemukan!");
        console.error("   DISCORD_GUILD_ID:", DISCORD_GUILD_ID);
        return;
    }

    try {
        // --- SINKRONISASI DATA ---
        console.log("📝 Sinkronisasi users_master...");
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

        // Hapus users yang tidak lagi punya required role
        if (activeDiscordIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('users_master')
                .delete()
                .not('discord_id', 'in', `(${activeDiscordIds.join(',')})`);
            
            if (deleteError) throw deleteError;
        }

        const { error: upsertError } = await supabase.from('users_master').upsert(dataToUpsert, { onConflict: 'discord_id' });
        if (upsertError) throw upsertError;
        
        console.log(`✓ Sinkronisasi berhasil (${dataToUpsert.length} users)`);
        await sendLog(`✓ Sinkronisasi ${dataToUpsert.length} users berhasil`);

        // --- PENGECEKAN USERS TANPA REQUIRED ROLE ---
        await checkAndDeleteUserWithoutRequiredRole(guild);

        // --- PEMBERSIHAN ORPHANED DATA ---
        await cleanupOrphanedAttendanceData(guild);

        // --- BROADCAST PENGUMUMAN (WIB) ---
        const formatter = new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta', hour: 'numeric', minute: 'numeric', hour12: false
        });
        
        const formattedDate = formatter.format(new Date());
        const [jamStr, menitStr] = formattedDate.replace('.', ':').split(':');
        const jam = parseInt(jamStr);
        const menit = parseInt(menitStr);

        const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            if (jam === 19 && menit >= 30 && menit <= 40) { 
                await channel.send("📢 **PENGUMUMAN DUTY**\nWAKTUNYA DUTY JIKA BERHALANGAN SILAHKAN IZIN ATAU CUTI DI https://exsg.netlify.app/\n\n@everyone");
            } 
            else if (jam === 22 && menit <= 10) {
                await channel.send("📢 **REMINDER ABSENSI**\nJANGAN LUPA UNTUK MENGISI KEHADIRAN DI https://exsg.netlify.app/\n\n@everyone");
            }
        }

        await sendLog("✓ Task SASG selesai");
        console.log("✓ Task SASG selesai\n");
    } catch (err) {
        console.error("❌ Terjadi kesalahan:", err.message);
        await sendLog(`❌ Error: ${err.message}`, 'warning');
    }
}

client.once('clientReady', () => {
    console.log(`\n🤖 Bot Pengecek SASG aktif sebagai ${client.user.tag}`);
    console.log("📋 Fitur aktif: Sync, Role Checking, Orphaned Cleanup, Auto Logging (Forum)");
    console.log("⚙️  Interval: Setiap 10 menit\n");
    
    // Jalankan tugas pertama kali saat bot nyala
    runSasgTask();

    // Jalankan tugas SETIAP 10 MENIT
    setInterval(() => {
        runSasgTask();
    }, 600000);
});

process.on('SIGTERM', () => {
    console.log("🛑 Bot dimatikan oleh sistem.");
    process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);