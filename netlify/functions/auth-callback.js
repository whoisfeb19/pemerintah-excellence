const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Inisialisasi Supabase menggunakan Environment Variables di Netlify
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
                body: "AKSES DITOLAK: Anda tidak memiliki Role SAPD di Discord."
            };
        }

        // --- MAPPING PANGKAT & DIVISI ---
        const PANGKAT_MAP = {
            "1444909938001580257": "CHIEF OF POLICE",
            "1444909771181522974": "ASSISTANT CHIEF OF POLICE",
            "1444909625475596349": "DEPUTY CHIEF OF POLICE",
            "1444908730230771723": "COMMANDER",
            "1444918644600606770": "CAPTAIN III",
            "1444918698484826173": "CAPTAIN II",
            "1444918744815112302": "CAPTAIN I",
            "1444918819717124186": "LIEUTENANT III",
            "1444918867691569244": "LIEUTENANT II",
            "1444918922766843904": "LIEUTENANT I",
            "1444919014139756685": "SERGEANT III",
            "1444919052815564910": "SERGEANT II",
            "1444919550981308426": "SERGEANT I",
            "1444919660054188032": "DETECTIVE III",
            "1444919733114896465": "DETECTIVE II",
            "1444919777553420339": "DETECTIVE I",
            "1444919938891649145": "POLICE OFFICER III",
            "1444920044239982673": "POLICE OFFICER II",
            "1444920144793964595": "POLICE OFFICER I",
            "1444920482578173953": "CADET"
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
            last_login: new Date().toISOString()
        });

        // 5. Redirect ke Dashboard dengan data yang sudah diverifikasi
        // isAdmin dipaksa menjadi string 'true' atau 'false' agar mudah dibaca frontend
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
