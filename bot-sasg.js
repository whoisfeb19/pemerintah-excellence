require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ChannelType, 
    Partials 
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// --- KONFIGURASI SUPABASE ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- INISIALISASI CLIENT DISCORD ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

// --- DAFTAR ID (KONFIGURASI) ---
const ANNOUNCEMENT_CHANNEL_ID = "1492401243476197376"; 
const FORUM_CHANNEL_ID = "1494352421294444595"; 
const STORAGE_BUCKET_NAME = "bukti-absen"; 
const REQUIRED_ROLE_ID = "1492398964610170940"; 
const ADMIN_ROLE_ID = "1492400977012068363"; 
const DISCORD_GUILD_ID = "1391854057487863998";

// --- MAPPING PANGKAT ---
const PANGKAT_MAP = {
    "1391976318366650410": "GUBERUR",
    "1391976320266801343": "WAKIL GUBERNUR",
    "1391976322154365018": "SEKRETARIS",
    "1391976325958471710": "KEPALA DIVISI",
    "1391976330014232597": "STAFF SENIOR",
    "1492398501685104740": "STAFF JUNIOR",
    "1492398633679585393": "STAFF MAGANG"
};

// --- MAPPING DIVISI ---
const DIVISI_MAP = {
    "1444921188215165141": "HIGHWAY PATROL",
    "1444920955620032533": "RAMPART DIVISION",
    "1444920880370159617": "METROPOLITAN",
    "1444908272363769887": "HUMAN RESOURCE BUREAU",
    "1444921352120434819": "INTERNAL AFFAIRS DIVISION"
};


// ✅ FUNGSI RETRY DENGAN EXPONENTIAL BACKOFF ---
async function withRetry(fn, maxRetries = 3, initialDelay = 1000) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            if (error.status === 429 || error.message?.includes('rate')) {
                const delay = (error.retry_after || initialDelay) * Math.pow(2, i);
                console.warn(`[RATE LIMIT] Menunggu ${delay}ms sebelum retry ke-${i + 1}...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else if (i < maxRetries - 1) {
                const delay = initialDelay * Math.pow(2, i);
                console.warn(`[RETRY ${i + 1}/${maxRetries}] Error: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    
    throw lastError;
}

// ✅ FUNGSI VALIDASI URL ---
function isValidUrl(url) {
    if (!url || typeof url !== 'string') return false;
    url = url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
    try {
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
}

// ✅ FUNGSI HAPUS DATA USER ---
async function deleteUserData(discordId) {
    try {
        // 1. Hapus gambar dari storage
        const { data: absenRecords, error: absenErr } = await supabase
            .from('absensi_sasg')
            .select('id, bukti_foto')
            .eq('discord_id', discordId);

        if (!absenErr && absenRecords && absenRecords.length > 0) {
            for (const record of absenRecords) {
                if (record.bukti_foto && isValidUrl(record.bukti_foto)) {
                    try {
                        const namaFile = record.bukti_foto.split('/').pop();
                        const pathLengkap = `absensi/${namaFile}`;
                        await supabase.storage.from(STORAGE_BUCKET_NAME).remove([pathLengkap]);
                        console.log(`  ✓ Gambar dihapus: ${namaFile}`);
                    } catch (imgErr) {
                        console.warn(`  ⚠ Error hapus gambar: ${imgErr.message}`);
                    }
                }
            }
        }

        // 2. Hapus data absensi
        await supabase.from('absensi_sasg').delete().eq('discord_id', discordId);
        console.log(`  ✓ Data absensi dihapus`);

        // 3. Hapus user dari users_master
        await supabase.from('users_master').delete().eq('discord_id', discordId);
        console.log(`  ✓ User ${discordId} dihapus dari database`);

    } catch (err) {
        console.error(`  ✗ Error deleteUserData: ${err.message}`);
    }
}

// ✅ FUNGSI CLEANUP USER TANPA REQUIRED ROLE ---
async function cleanupUsersWithoutRole(guild) {
    console.log("\n[CLEANUP-1] ========== MULAI CLEANUP USER ==========");
    
    try {
        const { data: allUsersInDb, error: fetchErr } = await supabase
            .from('users_master')
            .select('discord_id, nama_anggota');

        if (fetchErr || !allUsersInDb || allUsersInDb.length === 0) {
            console.log("[CLEANUP-1] Tidak ada user untuk di-cleanup");
            return;
        }

        console.log(`[CLEANUP-1] Ditemukan ${allUsersInDb.length} user di database`);

        let cleanupCount = 0;

        for (const userRecord of allUsersInDb) {
            const discordId = userRecord.discord_id;
            const namaUser = userRecord.nama_anggota;
            
            try {
                // ✅ PERBAIKAN: Gunakan simple fetch tanpa withRetry dulu
                let member = null;
                try {
                    member = await guild.members.fetch(discordId).catch(() => null);
                } catch (fetchErr) {
                    console.warn(`[WARN] Fetch error: ${fetchErr.message}`);
                    member = null;
                }

                // ✅ Jika user tidak ada atau tidak punya role
                if (!member || !member?.roles?.cache?.has(REQUIRED_ROLE_ID)) {
                    console.log(`[CLEANUP-1] User ${discordId} (${namaUser}) - HAPUS`);
                    await deleteUserData(discordId);
                    cleanupCount++;
                }
                
            } catch (err) {
                console.error(`  ✗ Error user ${discordId}: ${err.message}`);
                continue;
            }

            // ✅ PENTING: Delay 1 detik untuk avoid rate limit
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`[CLEANUP-1] ========== SELESAI (${cleanupCount} user dihapus) ==========\n`);
    } catch (errGlobal) {
        console.error("[CLEANUP-1 ERROR]", errGlobal.message);
    }
}

// ✅ FUNGSI CLEANUP ORPHANED ABSENSI ---
async function cleanupOrphanedAbsences(guild) {
    console.log("\n[CLEANUP-2] ========== MULAI CLEANUP ABSENSI ORPHANED ==========");
    
    try {
        const { data: validUsers, error: fetchValidErr } = await supabase
            .from('users_master')
            .select('discord_id');

        if (fetchValidErr || !validUsers) {
            console.log("[CLEANUP-2] Tidak bisa ambil valid users");
            return;
        }

        const validUserIds = validUsers.map(u => u.discord_id);

        const { data: allAbsences, error: fetchAbsenErr } = await supabase
            .from('absensi_sasg')
            .select('id, discord_id, bukti_foto');

        if (fetchAbsenErr || !allAbsences || allAbsences.length === 0) {
            console.log("[CLEANUP-2] Tidak ada absensi orphaned");
            return;
        }

        console.log(`[CLEANUP-2] Checking ${allAbsences.length} records...`);

        let orphanedCount = 0;

        for (const absenceRecord of allAbsences) {
            const discordId = absenceRecord.discord_id;
            const userInDb = validUserIds.includes(discordId);

            if (!userInDb) {
                console.log(`[CLEANUP-2] Absensi orphaned: User ${discordId}`);

                // Hapus gambar
                if (absenceRecord.bukti_foto && isValidUrl(absenceRecord.bukti_foto)) {
                    try {
                        const namaFile = absenceRecord.bukti_foto.split('/').pop();
                        await supabase.storage.from(STORAGE_BUCKET_NAME).remove([`absensi/${namaFile}`]);
                        console.log(`  ✓ Gambar dihapus: ${namaFile}`);
                    } catch (imgErr) {
                        console.warn(`  ⚠ Error hapus gambar: ${imgErr.message}`);
                    }
                }

                // Hapus absensi
                await supabase.from('absensi_sasg').delete().eq('id', absenceRecord.id);
                console.log(`  ✓ Absensi ${absenceRecord.id} dihapus`);
                orphanedCount++;
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`[CLEANUP-2] ========== SELESAI (${orphanedCount} dihapus) ==========\n`);
    } catch (err) {
        console.error("[CLEANUP-2 ERROR]", err.message);
    }
}

// ✅ FUNGSI TANDAI THREAD ARCHIVED ---
async function markThreadAsArchived(guild) {
    console.log("\n[ARCHIVE-THREAD] ========== MULAI ARCHIVE THREAD ==========");
    
    try {
        const forumChannel = await guild.channels.fetch(FORUM_CHANNEL_ID);
        if (!forumChannel) {
            console.error("[ERROR] Forum channel tidak ditemukan");
            return;
        }

        const { data: validUsers, error: fetchErr } = await supabase
            .from('users_master')
            .select('discord_id');

        if (fetchErr || !validUsers) return;

        const validUserIds = validUsers.map(u => u.discord_id);
        const threads = await forumChannel.threads.fetchActive();

        console.log(`[ARCHIVE-THREAD] Checking ${threads.threads.size} threads...`);

        let markedCount = 0;

        for (const [, thread] of threads.threads) {
            const idMatch = thread.name.match(/^\[(\d+)\]/);
            if (!idMatch) continue;

            const discordId = idMatch[1];
            const userInDb = validUserIds.includes(discordId);

            if (!userInDb && !thread.name.includes('[ARCHIVED]')) {
                const newName = `[ARCHIVED] ${thread.name}`.substring(0, 100);
                try {
                    await thread.edit({ name: newName });
                    markedCount++;
                    console.log(`[ARCHIVE-THREAD] Thread archived: ${thread.name}`);
                } catch (err) {
                    console.warn(`[WARN] Gagal archive thread: ${err.message}`);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`[ARCHIVE-THREAD] ========== SELESAI (${markedCount} archived) ==========\n`);
    } catch (err) {
        console.error("[ARCHIVE-THREAD ERROR]", err.message);
    }
}

// ✅ FUNGSI PROCESS FORUM LOGS ---
async function processForumLogs(guild) {
    console.log("\n[PROCESS-FORUM] ========== MULAI PROCESS FORUM LOGS ==========");
    
    try {
        const forumChannel = await guild.channels.fetch(FORUM_CHANNEL_ID);
        if (!forumChannel) {
            console.error("[ERROR] Forum channel tidak ditemukan");
            return;
        }

        const { data: logs, error: fetchError } = await supabase
            .from('absensi_sasg')
            .select('*')
            .eq('is_archived', false);

        if (fetchError || !logs || logs.length === 0) {
            console.log("[PROCESS-FORUM] Tidak ada log untuk diproses");
            return;
        }

        console.log(`[PROCESS-FORUM] Ditemukan ${logs.length} log untuk diproses`);

        for (let i = 0; i < logs.length; i++) {
            const log = logs[i];
            
            try {
                const statusKirim = log.tipe_absen || "HADIR";
                const alasanKirim = log.alasan || "Tidak ada keterangan";
                const namaUser = log.nama_anggota || "Unknown";
                const discordId = log.discord_id;

                console.log(`[PROCESS-FORUM] [${i + 1}/${logs.length}] ${namaUser}`);

                const threads = await forumChannel.threads.fetchActive();
                let targetThread = threads.threads.find(t => t.name.includes(`[${discordId}]`));

                if (!targetThread) {
                    targetThread = await forumChannel.threads.create({
                        name: `[${discordId}] ${namaUser}`.substring(0, 100),
                        message: { content: `Logs Kehadiran - **${namaUser}**` },
                    });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

                let warnaEmbed = 0x2ecc71;
                if (statusKirim === "IZIN") warnaEmbed = 0xf1c40f;
                else if (statusKirim === "CUTI") warnaEmbed = 0xe67e22;

                const imageUrls = [];
                if (log.bukti_foto && isValidUrl(log.bukti_foto)) {
                    imageUrls.push(log.bukti_foto);
                }

                const reportEmbed = new EmbedBuilder()
                    .setTitle(`LOG KEHADIRAN - ${statusKirim}`)
                    .setColor(warnaEmbed)
                    .addFields(
                        { name: 'Nama Anggota', value: namaUser, inline: true },
                        { name: 'Pangkat', value: log.pangkat || "-", inline: true },
                        { name: 'Divisi', value: log.divisi || "-", inline: true },
                        { name: 'Keterangan', value: alasanKirim, inline: false }
                    )
                    .setTimestamp(new Date(log.created_at))
                    .setFooter({ text: "SASG Attendance System" });

                const embeds = [reportEmbed];
                if (imageUrls.length > 0) {
                    imageUrls.forEach((url, index) => {
                        embeds.push(new EmbedBuilder().setImage(url).setColor(warnaEmbed));
                    });
                }

                await targetThread.send({ embeds });
                console.log(`  ✓ Log terkirim`);

                // Hapus gambar dari storage
                if (imageUrls.length > 0) {
                    for (const url of imageUrls) {
                        try {
                            const namaFile = url.split('/').pop();
                            await supabase.storage.from(STORAGE_BUCKET_NAME).remove([`absensi/${namaFile}`]);
                            console.log(`  ✓ File dihapus: ${namaFile}`);
                        } catch (storageErr) {
                            console.warn(`  ⚠ Error hapus storage: ${storageErr.message}`);
                        }
                    }
                }

                // Archive record
                await supabase.from('absensi_sasg').update({ is_archived: true }).eq('id', log.id);
                console.log(`  ✓ Data di-archive`);

            } catch (errLoop) {
                console.error(`[ERROR] Gagal proses log ${log.id}: ${errLoop.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        console.log("[PROCESS-FORUM] ========== SELESAI ==========\n");
    } catch (err) {
        console.error("[PROCESS-FORUM ERROR]", err.message);
    }
}

// ✅ MAIN TASK FUNCTION ---
async function runSasgTask() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`START TASK - ${new Date().toLocaleString('id-ID', {timeZone: 'Asia/Jakarta'})}`);
    console.log(`${'='.repeat(60)}`);
    
    const serverGuild = client.guilds.cache.get(DISCORD_GUILD_ID);
    if (!serverGuild) {
        console.error("[ERROR] Guild tidak ditemukan!");
        return;
    }

    try {
        // Phase 1: Cleanup
        await cleanupUsersWithoutRole(serverGuild);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await cleanupOrphanedAbsences(serverGuild);
        await new Promise(resolve => setTimeout(resolve, 2000));

        await markThreadAsArchived(serverGuild);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Phase 2: Process new logs
        await processForumLogs(serverGuild);

        console.log(`\n${'='.repeat(60)}`);
        console.log("✅ TASK COMPLETED SUCCESSFULLY");
        console.log(`${'='.repeat(60)}\n`);
    } catch (err) {
        console.error(`\n${'='.repeat(60)}`);
        console.error("❌ MAIN TASK ERROR:", err.message);
        console.error(`${'='.repeat(60)}\n`);
    }
}

// --- EVENT BOT READY ---
client.once('ready', () => {
    console.log("\n========================================");
    console.log(`✅ BOT SASG READY`);
    console.log(`📍 Username: ${client.user.tag}`);
    console.log(`🆔 User ID: ${client.user.id}`);
    console.log("Status: Online & Monitoring Supabase");
    console.log("========================================\n");
    
    // Jalankan task
    runSasgTask();
    
    // Jalankan setiap 10 menit
    setInterval(runSasgTask, 600000);
});

// --- ERROR HANDLING ---
client.on('error', (error) => {
    console.error('[CLIENT ERROR]', error);
});

process.on('SIGTERM', async () => {
    console.log('\n[SHUTDOWN] Bot sedang shutdown...');
    await client.destroy();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\n[SHUTDOWN] Bot sedang shutdown (SIGINT)...');
    await client.destroy();
    process.exit(0);
});

// --- LOGIN ---
client.login(process.env.DISCORD_BOT_TOKEN);