/**
 * REKAP.JS - FULL VERSION (READABLE)
 * Perbaikan: Urutan Inisialisasi Supabase & Security
 */

// --- 1. INISIALISASI SUPABASE (WAJIB DI PALING ATAS) ---
const _supabase = window.supabase.createClient(
    "https://knldblqwaumehhwaodmn.supabase.co", 
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtubGRibHF3YXVtZWhod2FvZG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4OTIwNzIsImV4cCI6MjA5MTQ2ODA3Mn0.EdMpVA8E4Vax8FCwJcKAJx-f-d80ysGWRsGLSAS_q3I"
);

let currentWeekOffset = 0;
let userWeekly = {}; 

// --- 2. SISTEM KEAMANAN & AUTHENTICATION ---
async function checkAuth() {
    const discordId = localStorage.getItem("discord_id");
    const isAdminLocal = localStorage.getItem("is_admin");

    // Jika di browser tidak ada data admin, langsung lempar ke dashboard
    if (!discordId || isAdminLocal !== "true") {
        return accessDenied();
    }

    // CEK VALIDASI KE DATABASE SUPABASE
    const { data: user, error } = await _supabase
        .from('users_master')
        .select('is_admin')
        .eq('discord_id', discordId)
        .single();

    // Jika di database status adminnya sudah dicabut/salah, kunci aksesnya
    if (error || !user || user.is_admin !== true) {
        localStorage.setItem("is_admin", "false"); 
        return accessDenied();
    } else {
        // Jika benar admin, baru tampilkan halaman dan muat data
        document.body.style.display = "block";
        loadData(); 
    }
}

function accessDenied() {
    alert("AKSES DITOLAK: Halaman ini hanya untuk High Command (Admin).");
    window.location.href = "dashboard.html";
}

// Jalankan proteksi segera setelah client supabase siap
checkAuth();

// --- 3. LOGIKA UTAMA: MUAT DATA MINGGUAN ---
async function loadData() {
    const { mon, sun } = getWeekRange(currentWeekOffset);
    document.getElementById('label-minggu').innerText = `${mon.toLocaleDateString('id-ID')} - ${sun.toLocaleDateString('id-ID')}`;

    const { data: logs } = await _supabase
        .from('absensi_sasg')
        .select('*')
        .gte('created_at', mon.toISOString())
        .lte('created_at', sun.toISOString());

    const { data: masters } = await _supabase
        .from('users_master')
        .select('*');

    // Sorting berdasarkan Pangkat (RANK_ORDER)
    if (typeof RANK_ORDER !== 'undefined' && masters) {
        masters.sort((a, b) => (RANK_ORDER[a.pangkat.toUpperCase()] || 99) - (RANK_ORDER[b.pangkat.toUpperCase()] || 99));
    }

    userWeekly = {}; 
    masters.forEach(m => {
        userWeekly[m.discord_id] = { 
            info: m, 
            days: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null }, 
            totalHadir: 0,
            uniqueDates: new Set() 
        };
    });

    logs.forEach(log => {
        const d = new Date(log.created_at).getDay();
        const dateKey = new Date(log.created_at).toISOString().split('T')[0];
        const discordId = log.discord_id;

        if (userWeekly[discordId] && d !== 0) {
            const ketAsli = (log.jam_duty || "").toUpperCase();
            const status = ketAsli.includes("IZIN") ? "IZIN" : (ketAsli.includes("CUTI") ? "CUTI" : "HADIR");

            // Mapping detail untuk Popup
            userWeekly[discordId].days[d] = { 
                status: status,
                ket: ketAsli,
                alasan: log.alasan || "-", 
                waktuDuty: log.jam_duty || "-", 
                bukti: log.bukti_foto || log.bukti_gambar,
                tanggalLog: new Date(log.created_at).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' }),
                divisi: userWeekly[discordId].info.divisi || "-"
            };

            if (status === "HADIR") {
                if (!userWeekly[discordId].uniqueDates.has(dateKey)) {
                    userWeekly[discordId].totalHadir++; 
                    userWeekly[discordId].uniqueDates.add(dateKey); 
                }
            }
        }
    });

    let totalGajiSemua = 0;
    const currentAdminName = localStorage.getItem("nama_user");
    const currentAdminRank = localStorage.getItem("pangkat");

    document.getElementById('tbody-weekly').innerHTML = masters.map(m => {
        const u = userWeekly[m.discord_id];

        // Hitung Gaji (Jika fungsi tersedia)
        const hasilGaji = typeof hitungGajiMember === 'function' 
            ? hitungGajiMember(m.pangkat, u.totalHadir) 
            : { gajiAkhir: 0 };

        const totalGaji = hasilGaji.gajiAkhir;
        totalGajiSemua += totalGaji;

        const cWarn = m.total_warning || 0;
        
        const getIcon = (idx) => {
            const data = u.days[idx];
            if (!data) return `<span class="cross-icon">✘</span>`;
            
            let label = "✔";
            let iconClass = "check-icon";
            if (data.status === "IZIN") { label = "I"; iconClass = "status-ic"; }
            if (data.status === "CUTI") { label = "C"; iconClass = "status-ic"; }

            // Ubah data objek menjadi string untuk parameter onclick
            const dataStr = JSON.stringify(data).replace(/"/g, '&quot;');
            return `<span class="${iconClass}" style="cursor:pointer;" onclick="openDetailPopup('${m.nama_anggota}', '${m.pangkat}', ${dataStr})">${label}</span>`;
        };

        return `<tr>
            <td style="text-align:left;"><b>${m.nama_anggota}</b></td>
            <td>${m.pangkat}</td>
            ${[1,2,3,4,5,6].map(i => `<td>${getIcon(i)}</td>`).join('')}
            <td>${u.totalHadir}/6</td>
            <td class="salary-text">$${totalGaji.toLocaleString()}</td>
            <td>
                <div style="display:flex; flex-direction:column; align-items:center; gap:5px;">
                    <button class="btn-warning" onclick="sendWarning('${m.discord_id}', '${m.nama_anggota}', '${m.pangkat}', ${cWarn}, '${currentAdminName}', '${currentAdminRank}')">⚠️ Warning (${cWarn})</button>
                    ${cWarn > 0 ? `<span class="unwarn-link" onclick="removeWarning('${m.discord_id}', '${m.nama_anggota}', '${m.pangkat}', ${cWarn}, '${currentAdminName}', '${currentAdminRank}')">[ Cabut SP ]</span>` : ''}
                </div>
            </td>
            <td><button onclick="resetUser('${m.discord_id}')" style="background:none;border:none;cursor:pointer;">🗑</button></td>
        </tr>`;
    }).join('');

    document.getElementById('total-gaji-global').innerText = `$${totalGajiSemua.toLocaleString()}`;
}

// --- 4. FITUR POPUP DETAIL (FIX LAYOUT & MULTI-IMAGE) ---
function openDetailPopup(nama, pangkat, data) {
    const modal = document.getElementById('modal-detail');
    const content = document.getElementById('detail-content');
    
    content.style.maxHeight = "80vh";
    content.style.overflowY = "auto";

    // Pecah string bukti_foto menjadi array jika ada banyak gambar
    const daftarGambar = data.bukti && data.bukti !== "N/A" ? data.bukti.split(', ') : [];

    content.innerHTML = `
        <div style="color: #eee; font-family: 'Segoe UI', sans-serif; padding: 5px;">
            <h3 style="text-align:center; border-bottom: 2px solid #00adb5; padding-bottom: 10px; margin-bottom: 15px; color:#00adb5;">DETAIL ABSENSI</h3>
            
            <style>
                .pop-row { display: flex; margin-bottom: 10px; line-height: 1.4; border-bottom: 1px solid #333; padding-bottom: 5px; }
                .pop-label { width: 100px; color: #00adb5; font-weight: bold; flex-shrink: 0; }
                .pop-colon { width: 20px; flex-shrink: 0; text-align: center; }
                .pop-val { flex-grow: 1; word-break: break-word; overflow-wrap: anywhere; }
                .img-thumbnail-container { 
                    display: flex; 
                    flex-wrap: wrap; 
                    gap: 10px; 
                    margin-top: 10px; 
                }
                .img-thumbnail { 
                    width: 100px; 
                    height: 100px; 
                    object-fit: cover; 
                    border-radius: 6px; 
                    border: 2px solid #30475e; 
                    cursor: pointer; 
                    transition: transform 0.2s;
                }
                .img-thumbnail:hover { transform: scale(1.05); border-color: #00adb5; }
            </style>

            <div class="pop-row"><div class="pop-label">Nama</div><div class="pop-colon">:</div><div class="pop-val">${nama}</div></div>
            <div class="pop-row"><div class="pop-label">Pangkat</div><div class="pop-colon">:</div><div class="pop-val">${pangkat}</div></div>
            <div class="pop-row"><div class="pop-label">Divisi</div><div class="pop-colon">:</div><div class="pop-val">${data.divisi}</div></div>
            <div class="pop-row"><div class="pop-label">Hari</div><div class="pop-colon">:</div><div class="pop-val">${data.tanggalLog}</div></div>
            <div class="pop-row"><div class="pop-label">Waktu</div><div class="pop-colon">:</div><div class="pop-val">${data.waktuDuty}</div></div>
            <div class="pop-row">
                <div class="pop-label">Status</div><div class="pop-colon">:</div>
                <div class="pop-val"><span style="background:#00adb5; color:#000; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:11px;">${data.status}</span></div>
            </div>
            <div class="pop-row" style="border-bottom:none;">
                <div class="pop-label">Alasan</div><div class="pop-colon">:</div>
                <div class="pop-val" style="font-style:italic; color:#bbb;">${data.alasan}</div>
            </div>

            <div style="margin-top:20px; border-top: 1px solid #444; padding-top:10px;">
                <p style="color:#00adb5; font-weight:bold; margin-bottom:10px;">Bukti Gambar (${daftarGambar.length}):</p>
                <div class="img-thumbnail-container">
                    ${daftarGambar.length > 0 ? 
                        daftarGambar.map(url => `
                            <img src="${url}" class="img-thumbnail" title="Klik untuk memperbesar" onclick="window.open('${url}', '_blank')">
                        `).join('') : 
                        `<div style="width:100%; padding:20px; text-align:center; background:#222831; border-radius:8px; color:#666;">Tidak ada bukti gambar.</div>`
                    }
                </div>
                ${daftarGambar.length > 0 ? `<p style="font-size: 10px; color: #666; margin-top: 5px;">* Klik gambar untuk melihat ukuran penuh</p>` : ''}
            </div>
        </div>
    `;
    modal.style.display = "flex";
}

function closeDetailPopup() {
    document.getElementById('modal-detail').style.display = "none";
}

// Tutup popup jika klik di luar area modal
window.onclick = function(event) {
    const modal = document.getElementById('modal-detail');
    if (event.target == modal) closeDetailPopup();
}

// --- 5. FITUR WARNING & DISCORD INTEGRATION ---
async function sendWarning(discord_id, nama_anggota, pangkat_anggota, currentWarn, adminName, adminRank) {
    if (!confirm(`Kirim SP-${currentWarn + 1} ke Discord?\n(Oleh: ${adminName} - ${adminRank})`)) return;
    
    const { mon } = getWeekRange(currentWeekOffset);
    const u = userWeekly[discord_id];
    const daftarBolos = [];
    const hari = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    
    for(let i=1; i<=6; i++) { 
        if(!u.days[i]) { 
            const t=new Date(mon); 
            t.setDate(mon.getDate()+(i-1)); 
            daftarBolos.push(`- ${hari[i]}, ${t.toLocaleDateString('id-ID')}`); 
        } 
    }

    const newWarnCount = currentWarn + 1;
    const logPayload = {
        "content": "@everyone <@&1444908462067945623>",
        "embeds": [{
            "title": `📋 SURAT PERINGATAN (SP - ${newWarnCount})`,
            "color": 15285324,
            "description": `**Tanggal:** ${new Date().toLocaleDateString('id-ID')}\n**Nama Anggota:** ${nama_anggota} (<@${discord_id}>)\n**Pangkat:** ${pangkat_anggota}\n\n**Alasan Peringatan:**\nTidak memenuhi syarat kehadiran mingguan.\nDetail Bolos:\n${daftarBolos.join('\n')}\n**Total SP:** ${newWarnCount}\n\n**Pemberi Peringatan:** ${adminName}\n**Pangkat:** ${adminRank}`,
            "timestamp": new Date()
        }]
    };

    await _supabase.from('users_master').update({ total_warning: newWarnCount }).eq('discord_id', discord_id);
    
    const res = await fetch('/.netlify/functions/send-warning', { 
        method: 'POST', 
        body: JSON.stringify({ payload: logPayload, updateList: await updateDiscordList() }) 
    });

    if (res.ok) { 
        alert("SP Terkirim!"); 
        loadData(); 
    }
}

async function removeWarning(discord_id, nama_anggota, pangkat_anggota, currentWarn, adminName, adminRank) {
    if (!confirm(`Cabut SP untuk ${nama_anggota}?\n(Oleh: ${adminName} - ${adminRank})`)) return;
    const newWarnCount = Math.max(0, currentWarn - 1);

    const logPayload = {
        "content": "<@&1444908462067945623>",
        "embeds": [{
            "title": `🔓 PENCABUTAN SURAT PERINGATAN`,
            "color": 3066993,
            "description": `**Tanggal:** ${new Date().toLocaleDateString('id-ID')}\n**Nama Anggota:** ${nama_anggota} (<@${discord_id}>)\n**Pangkat Anggota:** ${pangkat_anggota}\n\n**Status:** 1 SP telah dicabut.\n**Sisa SP:** ${newWarnCount}\n\n**Dicabut Oleh:** ${adminName}\n**Pangkat Admin:** ${adminRank}`,
            "timestamp": new Date()
        }]
    };

    await _supabase.from('users_master').update({ total_warning: newWarnCount }).eq('discord_id', discord_id);
    
    const res = await fetch('/.netlify/functions/send-warning', { 
        method: 'POST', 
        body: JSON.stringify({ payload: logPayload, updateList: await updateDiscordList() }) 
    });

    if (res.ok) { 
        alert("SP Berhasil dicabut!"); 
        loadData(); 
    }
}

async function updateDiscordList() {
    const { data: masters } = await _supabase.from('users_master').select('*');
    if (typeof RANK_ORDER !== 'undefined') {
        masters.sort((a, b) => (RANK_ORDER[a.pangkat.toUpperCase()] || 99) - (RANK_ORDER[b.pangkat.toUpperCase()] || 99));
    }
    
    let txt = "## 📊 DAFTAR TOTAL WARNING ANGGOTA PEMERINTAH\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
    masters.forEach(m => {
        const emoji = m.total_warning >= 3 ? "🔴" : (m.total_warning > 0 ? "🟡" : "🟢");
        txt += `${emoji} ${m.nama_anggota} (<@${m.discord_id}>) : \`${m.total_warning || 0} SP\`\n`;
    });
    return txt.substring(0, 1990);
}

// --- 6. EXPORT TOOLS (EXCEL & PDF) ---
function downloadExcel() {
    const rows = [["Nama Anggota", "Pangkat", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Total", "Gaji"]];
    document.querySelectorAll("#tbody-weekly tr").forEach(tr => {
        const rowData = [];
        tr.querySelectorAll("td").forEach((td, i) => {
            if(i < 10) {
                let val = td.innerText.trim();
                if(td.querySelector(".check-icon")) val = "HADIR";
                else if(td.querySelector(".cross-icon")) val = "ALPA";
                rowData.push(val);
            }
        });
        rows.push(rowData);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:25}, {wch:20}, {wch:8}, {wch:8}, {wch:8}, {wch:8}, {wch:8}, {wch:8}, {wch:8}, {wch:12}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap");
    XLSX.writeFile(wb, `Rekap_SASG.xlsx`);
}

function downloadPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.autoTable({
        html: '#table-rekap',
        columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        theme: 'grid',
        styles: { fontSize: 8, lineWidth: 0.1, lineColor: [48, 71, 94] },
        didParseCell: function(data) {
            if (data.cell.section === 'body') {
                const txt = data.cell.raw.innerText;
                if (txt === '✔') { data.cell.styles.fillColor = [39, 174, 96]; data.cell.styles.textColor = 255; }
                else if (txt === 'I' || txt === 'C') { data.cell.styles.fillColor = [243, 156, 18]; data.cell.styles.textColor = 255; }
                else if (txt === '✘') { data.cell.styles.fillColor = [233, 69, 96]; data.cell.styles.textColor = 255; }
            }
        }
    });
    doc.save(`Rekap_SASG.pdf`);
}

// --- 7. UTILS & DATA MANAGEMENT ---
function getWeekRange(offset = 0) {
    const now = new Date(); 
    now.setDate(now.getDate() + (offset * 7));
    const day = now.getDay(); 
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(now.setDate(diff)); 
    mon.setHours(0,0,0,0);
    const sun = new Date(mon); 
    sun.setDate(mon.getDate() + 6); 
    sun.setHours(23,59,59,999);
    return { mon, sun };
}

async function resetUser(id) {
    if (!confirm("Hapus data absensi & bukti gambar anggota ini di minggu ini?")) return;
    const { mon, sun } = getWeekRange(currentWeekOffset);
    
    const { data: logs } = await _supabase.from('absensi_sasg')
        .select('bukti_foto') 
        .eq('discord_id', id)
        .gte('created_at', mon.toISOString())
        .lte('created_at', sun.toISOString());

    if (logs && logs.length > 0) {
        let filesToRemove = [];
        logs.forEach(log => {
            if (log.bukti_foto && log.bukti_foto !== "N/A") {
                const urls = log.bukti_foto.split(', ');
                urls.forEach(url => {
                    const fileName = url.split('/absensi/')[1];
                    if (fileName) filesToRemove.push(`absensi/${fileName}`);
                });
            }
        });

        if (filesToRemove.length > 0) {
            await _supabase.storage.from('bukti-absen').remove(filesToRemove);
        }
    }

    await _supabase.from('absensi_sasg')
        .delete()
        .eq('discord_id', id)
        .gte('created_at', mon.toISOString())
        .lte('created_at', sun.toISOString());

    alert("Data dan Gambar berhasil dihapus!");
    loadData();
}

async function resetAllWeeklyData() {
    if (!confirm("Hapus SEMUA data absensi & bukti gambar minggu ini?")) return;
    const { mon, sun } = getWeekRange(currentWeekOffset);

    const { data: allLogs } = await _supabase.from('absensi_sasg')
        .select('bukti_foto')
        .gte('created_at', mon.toISOString())
        .lte('created_at', sun.toISOString());

    if (allLogs && allLogs.length > 0) {
        let filesToRemove = [];
        allLogs.forEach(log => {
            if (log.bukti_foto && log.bukti_foto !== "N/A") {
                const urls = log.bukti_foto.split(', ');
                urls.forEach(url => {
                    const fileName = url.split('/absensi/')[1];
                    if (fileName) filesToRemove.push(`absensi/${fileName}`);
                });
            }
        });
        if (filesToRemove.length > 0) {
            await _supabase.storage.from('bukti-absen').remove(filesToRemove);
        }
    }

    await _supabase.from('absensi_sasg')
        .delete()
        .gte('created_at', mon.toISOString())
        .lte('created_at', sun.toISOString());

    alert("Seluruh data minggu ini telah dibersihkan!");
    loadData();
}

function changeWeek(dir) { 
    currentWeekOffset += dir; 
    loadData(); 
}