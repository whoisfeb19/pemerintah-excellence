const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Inisialisasi Supabase menggunakan Environment Variables
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

exports.handler = async (event) => {
    const { code } = event.queryStringParameters;
    if (!code) return { statusCode: 400, body: "Authorization code missing" };

    try {
        // 1. Tukar code dengan token OAuth2 dari Discord
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: process.env.DISCORD_REDIRECT_URI,
            scope: 'identify',
        }));

        const accessToken = tokenRes.data.access_token;

        // 2. Ambil ID User yang sedang login
        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userId = userRes.data.id;

        // 3. Ambil data member (Nickname & Roles) menggunakan Bot Token
        const memberRes = await axios.get(
            `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}`,
            { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );

        const { nick, roles, user: userData } = memberRes.data;
        const displayName = nick || userData.global_name || userData.username;

        // --- VALIDASI ROLE INTI ---
        const REQUIRED_ROLE_ID = process.env.DISCORD_REQUIRED_ROLE_ID; 
        const hasRequiredRole = roles.includes(REQUIRED_ROLE_ID);

        if (!hasRequiredRole) {
            // Jika role dicabut di Discord, hapus dari database master
            await supabase.from('users_master').delete().eq('discord_id', userId);
            
            return {
                statusCode: 403,
                body: "AKSES DITOLAK: Anda tidak memiliki Role Anggota Pemerintah di Discord."
            };
        }

        // --- MAPPING PANGKAT & DIVISI ---
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
            "1444920880370159617": "METROPOLITAN",
            "1444920955620032533": "RAMPART DIVISION",
            "1444921188215165141": "HIGHWAY PATROL",
            "1444908272363769887": "HUMAN RESOURCE BUREAU",
            "1444921352120434819": "INTERNAL AFFAIRS DIVISION"
        };

        let userPangkat = "Unknown";
        let userDivisi = "-";
        const adminRoleId = "1492400977012068363";
        let isAdmin = roles.includes(adminRoleId);

        roles.forEach(r => {
            if (PANGKAT_MAP[r]) userPangkat = PANGKAT_MAP[r];
            if (DIVISI_MAP[r]) userDivisi = DIVISI_MAP[r];
        });

        // 4. Update Database Master Supabase
        await supabase.from('users_master').upsert({
            discord_id: userId,
            nama_anggota: displayName,
            pangkat: userPangkat,
            divisi: userDivisi,
            is_admin: isAdmin, // <--- TAMBAHKAN INI
            last_login: new Date().toISOString()
        }, { onConflict: 'discord_id' });

        // --- TAMBAHAN: UPDATE OTOMATIS TABEL ABSENSI ---
        // Ini memastikan riwayat absen lama ikut berubah mengikuti data Discord terbaru
        await supabase.from('absensi_sasg').update({
            nama_anggota: displayName,
            pangkat: userPangkat,
            divisi: userDivisi
        }).eq('discord_id', userId);

        // 5. Redirect ke Dashboard dengan data yang sudah diverifikasi
        const redirectUrl = `/dashboard.html?id=${userId}` +
                            `&name=${encodeURIComponent(displayName)}` +
                            `&pangkat=${encodeURIComponent(userPangkat)}` +
                            `&divisi=${encodeURIComponent(userDivisi)}` +
                            `&admin=${isAdmin ? 'true' : 'false'}`;
        
        return {
            statusCode: 302,
            headers: { Location: redirectUrl }
        };

    } catch (err) {
        console.error("Login Error:", err);
        return { 
            statusCode: 500, 
            body: "Terjadi kesalahan server. Pastikan BOT Discord aktif dan Environment Variables di Netlify sudah benar." 
        };
    }
};