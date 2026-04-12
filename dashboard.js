/**
 * DASHBOARD.JS - VERSI SINKRONISASI OTOMATIS
 */

const _supabase = window.supabase.createClient(
    "https://knldblqwaumehhwaodmn.supabase.co", 
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtubGRibHF3YXVtZWhod2FvZG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4OTIwNzIsImV4cCI6MjA5MTQ2ODA3Mn0.EdMpVA8E4Vax8FCwJcKAJx-f-d80ysGWRsGLSAS_q3I"
);

let selectedFiles = [];

window.onload = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const discordId = urlParams.get('id');
    const name = urlParams.get('name');
    const rank = urlParams.get('pangkat');
    const divisi = urlParams.get('divisi');
    const isAdmin = urlParams.get('admin') === 'true';

    // Simpan data dari URL jika ada (saat login pertama)
    if (discordId && name) {
        localStorage.setItem("discord_id", discordId);
        localStorage.setItem("nama_user", decodeURIComponent(name));
        localStorage.setItem("pangkat", decodeURIComponent(rank || "Unknown"));
        localStorage.setItem("divisi", decodeURIComponent(divisi || "-"));
        localStorage.setItem("is_admin", isAdmin);

        await _supabase.from('users_master').upsert({
            discord_id: discordId,
            nama_anggota: decodeURIComponent(name),
            pangkat: decodeURIComponent(rank || "Unknown"),
            divisi: decodeURIComponent(divisi || "-")
        }, { onConflict: 'discord_id' });

        window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (!localStorage.getItem("discord_id")) { 
        window.location.href = "index.html"; 
        return;
    }

    // Jalankan update tampilan (sekarang memanggil database)
    await updateUI();
    toggleFormMode();
    updateGajiDisplay(); 
};

// --- LOGIKA DASHBOARD DATA (SINKRON KE DATABASE) ---
async function updateUI() {
    const discId = localStorage.getItem("discord_id");

    try {
        // AMBIL DATA TERBARU DARI DATABASE users_master
        const { data: user, error } = await _supabase
            .from('users_master')
            .select('nama_anggota, pangkat, divisi')
            .eq('discord_id', discId)
            .single();

        if (user && !error) {
            // Update LocalStorage agar sinkron dengan Database
            localStorage.setItem("nama_user", user.nama_anggota);
            localStorage.setItem("pangkat", user.pangkat);
            localStorage.setItem("divisi", user.divisi);
        }
    } catch (e) { console.warn("Gagal sinkron database, menggunakan cache local."); }

    // Tampilkan ke layar
    document.getElementById('name-display').innerText = localStorage.getItem("nama_user");
    document.getElementById('rank-display').innerText = `${localStorage.getItem("pangkat")} | ${localStorage.getItem("divisi")}`;
    
    if (localStorage.getItem("is_admin") === "true") {
        const adminLink = document.getElementById('admin-link');
        if(adminLink) adminLink.style.display = 'block';
    }
}

// --- PROSES SUBMIT ---
document.getElementById('absensi-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit');
    const msg = document.getElementById('status-msg');
    const statusAbsen = document.getElementById('status_absen').value;
    const discordId = localStorage.getItem("discord_id");
    
    btn.disabled = true;
    btn.innerText = "Memproses...";

    try {
        let dateList = [];
        if (statusAbsen === "CUTI") {
            let dStart = new Date(document.getElementById('cuti_mulai').value);
            let dEnd = new Date(document.getElementById('cuti_selesai').value);
            for (let d = new Date(dStart); d <= dEnd; d.setDate(d.getDate() + 1)) {
                if (d.getDay() !== 0) dateList.push(new Date(d));
            }
        } else {
            let tglVal = new Date(document.getElementById('tanggal_absen').value);
            if (tglVal.getDay() === 0) throw new Error("Hari Minggu libur!");
            dateList.push(tglVal);
        }

        // UNGGAH BANYAK GAMBAR
        let allImgUrls = [];
        if (statusAbsen === "HADIR" && selectedFiles.length > 0) {
            btn.innerText = `Mengunggah ${selectedFiles.length} Foto...`;
            for (let file of selectedFiles) {
                const path = `absensi/${Date.now()}_${Math.random().toString(36).substr(2, 5)}_${discordId}.png`;
                await _supabase.storage.from('bukti-absen').upload(path, file);
                const url = _supabase.storage.from('bukti-absen').getPublicUrl(path).data.publicUrl;
                allImgUrls.push(url);
            }
        }

        const finalImgString = allImgUrls.length > 0 ? allImgUrls.join(", ") : "N/A";

        const reports = dateList.map(d => ({
            discord_id: discordId,
            nama_anggota: localStorage.getItem("nama_user"),
            pangkat: localStorage.getItem("pangkat"),
            divisi: localStorage.getItem("divisi"),
            tipe_absen: statusAbsen, 
            jam_duty: (statusAbsen === "HADIR") ? `${document.getElementById('jam_mulai').value} - ${document.getElementById('jam_selesai').value}` : null,
            alasan: document.getElementById('kegiatan').value,
            bukti_foto: finalImgString, 
            created_at: d.toISOString()
        }));

        const response = await fetch('/.netlify/functions/submit-absensi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reports)
        });

        const result = await response.json();

        if (response.status === 403) {
            alert("Akses Ditolak! Anda bukan lagi bagian dari Pemerintah.");
            localStorage.clear();
            window.location.href = "index.html";
            return;
        }

        if (response.status !== 200) throw new Error("Gagal mengirim.");

        // JIKA BERHASIL, UPDATE LOCALSTORAGE DENGAN DATA TERBARU DARI SERVER
        if (result.updatedData) {
            localStorage.setItem("nama_user", result.updatedData.name);
            localStorage.setItem("pangkat", result.updatedData.pangkat);
            localStorage.setItem("divisi", result.updatedData.divisi);
        }

        msg.innerText = "✔ Berhasil dikirim & Data Diperbarui!";
        msg.style.color = "#2ecc71";
        
        document.getElementById('absensi-form').reset();
        selectedFiles = [];
        renderPreview();
        await updateUI(); // Update tampilan layar
        updateGajiDisplay();

    } catch (err) {
        msg.innerText = "❌ " + err.message;
        msg.style.color = "#e94560";
    } finally {
        btn.disabled = false;
        btn.innerText = "Kirim Laporan";
    }
});

// --- SISA FUNGSI LAINNYA (Preview, Gaji, dll tetap sama) ---
function renderPreview() {
    const gallery = document.getElementById('preview-gallery');
    gallery.innerHTML = "";
    selectedFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const div = document.createElement('div');
            div.style.cssText = "position: relative; width: 80px; height: 80px; border-radius: 8px; overflow: hidden; border: 2px solid #30475e;";
            div.innerHTML = `<img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover;">
                             <button type="button" onclick="removeImage(${index})" style="position: absolute; top: 2px; right: 2px; background: #e94560; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 12px; font-weight: bold; display: flex; align-items: center; justify-content: center;">✕</button>`;
            gallery.appendChild(div);
        }
        reader.readAsDataURL(file);
    });
}

function removeImage(index) {
    selectedFiles.splice(index, 1);
    renderPreview();
}

document.getElementById('bukti_foto').addEventListener('change', function(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => {
        if (!selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
            selectedFiles.push(file);
        }
    });
    renderPreview();
    this.value = "";
});

async function updateGajiDisplay() {
    const discId = localStorage.getItem("discord_id");
    const pangkat = localStorage.getItem("pangkat");
    const d = new Date();
    const day = d.getDay(), diff = d.getDate() - day + (day == 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);

    try {
        const { data: logs } = await _supabase.from('absensi_sasg').select('jam_duty, created_at').eq('discord_id', discId).gte('created_at', monday.toISOString());
        const hariHadirUnik = new Set();
        const hariIzinUnik = new Set();
        const hariCutiUnik = new Set();
        if (logs) {
            logs.forEach(l => {
                const tanggalHanya = new Date(l.created_at).toISOString().split('T')[0];
                const ket = (l.jam_duty || "").toUpperCase();
                if (ket.includes("IZIN")) hariIzinUnik.add(tanggalHanya);
                else if (ket.includes("CUTI")) hariCutiUnik.add(tanggalHanya);
                else hariHadirUnik.add(tanggalHanya);
            });
        }
        const h = hariHadirUnik.size;
        const totalInput = h + hariIzinUnik.size + hariCutiUnik.size;
        const hasil = hitungGajiMember(pangkat, h);
        document.getElementById('gaji-val').innerText = `$${hasil.gajiAkhir.toLocaleString()}`;
        document.getElementById('stat-hadir').innerText = h;
        document.getElementById('stat-izin').innerText = hariIzinUnik.size;
        document.getElementById('stat-cuti').innerText = hariCutiUnik.size;
        document.getElementById('stat-alpa').innerText = Math.max(0, 6 - totalInput);
    } catch (err) { console.error(err); }
}

function toggleFormMode() {
    const status = document.getElementById('status_absen').value;
    const today = new Date().toLocaleDateString('en-CA'); 
    const hadirSec = document.getElementById('hadir-section');
    const singleSec = document.getElementById('single-date-section');
    const rangeSec = document.getElementById('range-date-section');
    const tglInput = document.getElementById('tanggal_absen');
    if (status === "HADIR") {
        singleSec.style.display = "block"; rangeSec.style.display = "none"; hadirSec.style.display = "block";
        tglInput.max = today;
    } else if (status === "IZIN") {
        singleSec.style.display = "block"; rangeSec.style.display = "none"; hadirSec.style.display = "none";
        tglInput.min = today;
    } else if (status === "CUTI") {
        singleSec.style.display = "none"; rangeSec.style.display = "block"; hadirSec.style.display = "none";
    }
}

function logout() { 
    if (confirm("Logout?")) { localStorage.clear(); window.location.href = "index.html"; }
}