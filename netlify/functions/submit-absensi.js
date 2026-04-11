const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const body = JSON.parse(event.body);
    const reports = Array.isArray(body) ? body : [body];
    const discordId = reports[0].discord_id;

    // --- DAFTAR MAPPING PANGKAT & DIVISI ---
    const PANGKAT_MAP = {
            "1391976318366650410": "GUBERUR",
            "1391976320266801343": "WAKIL GUBERNUR",
            "1391976322154365018": "SEKRETARIS",
            "1391976324188602419": "KEPALA KEUANGAN",
            "1391976325958471710": "KEPALA DIVISI",
            "1391976327598444587": "WAKIL KEPALA DIVISI",
            "1391976330014232597": "STAFF SENIOR",
            "1492398501685104740": "STAFF JUNIOR",
            "1492398633679585393": "STAFF MAGANG"
    };

    const PANGKAT_PRIORITY = [
            "1391976318366650410",
            "1391976320266801343",
            "1391976322154365018",
            "1391976324188602419",
            "1391976325958471710",
            "1391976327598444587",
            "1391976330014232597",
            "1492398501685104740",
            "1492398633679585393"
    ];

    const DIVISI_MAP = {
        "1444920880370159617": "METROPOLITAN",
        "1444920955620032533": "RAMPART DIVISION",
        "1444921188215165141": "HIGHWAY PATROL",
        "1444908272363769887": "HUMAN RESOURCE BUREAU",
        "1444921352120434819": "INTERNAL AFFAIRS DIVISION"
    };

    try {
        const memberRes = await axios.get(
            `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordId}`,
            { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );

        const { roles, nick, user: discordUser } = memberRes.data;
        const REQUIRED_ROLE_ID = process.env.DISCORD_REQUIRED_ROLE_ID;

        if (!roles.includes(REQUIRED_ROLE_ID)) {
            await supabase.from('users_master').delete().eq('discord_id', discordId);
            return { statusCode: 403, body: JSON.stringify({ message: "KICKED" }) };
        }

        let freshPangkat = "Unknown";
        for (const roleId of PANGKAT_PRIORITY) {
            if (roles.includes(roleId)) {
                freshPangkat = PANGKAT_MAP[roleId];
                break;
            }
        }

        let freshDivisi = "-";
        roles.forEach(r => {
            if (DIVISI_MAP[r]) freshDivisi = DIVISI_MAP[r];
        });

        const freshName = nick || discordUser.global_name || discordUser.username;

        // 1. UPDATE TABEL MASTER (Identitas Utama)
        await supabase.from('users_master').update({
            nama_anggota: freshName,
            pangkat: freshPangkat,
            divisi: freshDivisi
        }).eq('discord_id', discordId);

        // 2. UPDATE SEMUA DATA LAMA DI TABEL ABSENSI (Sinkronisasi Massal)
        // Bagian ini akan mencari semua baris dengan discord_id yang sama dan mengubah identitasnya
        await supabase.from('absensi_sapd').update({
            nama_anggota: freshName,
            pangkat: freshPangkat,
            divisi: freshDivisi
        }).eq('discord_id', discordId);

        // 3. INSERT DATA ABSENSI BARU
        const { error: insertError } = await supabase.from('absensi_sapd').insert(
            reports.map(r => ({
                discord_id: discordId,
                nama_anggota: freshName,
                pangkat: freshPangkat,
                divisi: freshDivisi,
                jam_duty: r.jam_duty,
                kegiatan: r.kegiatan,
                bukti_foto: r.bukti_foto,
                created_at: r.created_at || new Date().toISOString()
            }))
        );

        if (insertError) throw insertError;

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: "SUCCESS", 
                updatedData: { name: freshName, pangkat: freshPangkat, divisi: freshDivisi } 
            })
        };

    } catch (err) {
        console.error(err);
        if (err.response && err.response.status === 404) {
            await supabase.from('users_master').delete().eq('discord_id', discordId);
            return { statusCode: 403, body: JSON.stringify({ message: "KICKED" }) };
        }
        return { statusCode: 500, body: JSON.stringify({ message: "SERVER ERROR" }) };
    }
};
