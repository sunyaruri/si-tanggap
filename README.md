# SI-TANGGAP – Prototipe

Prototipe web untuk penelitian SI-TANGGAP: tata kelola krisis distribusi BBM di Kabupaten Jember berbasis *early warning system*, kuota adaptif anti-spekulan, dan komunikasi risiko terintegrasi.

> **Prototipe penelitian, bukan layanan resmi.** Semua angka adalah keluaran simulasi dari parameter asumsi di `js/core/config.js`, bukan data lapangan. Lokasi 58 SPBU dan nomor polisi bersifat ilustratif. Prototipe ini bukan layanan PT Pertamina (Persero), PT Pertamina Patra Niaga, atau Pemerintah Kabupaten Jember. Warna antarmuka terinspirasi logo Pertamina dan bukan identitas visual resmi.

## Membuka

- Daring: <https://sunyaruri.github.io/si-tanggap/>
- Lokal: buka `index.html` (klik dua kali). Peta memerlukan koneksi internet untuk memuat tile OpenStreetMap.

## Tampilan

| Peran | Alamat |
| --- | --- |
| Pemda (6 halaman) | `#pemda/ringkasan`, `#pemda/peta`, `#pemda/proyeksi`, `#pemda/rekomendasi`, `#pemda/penimbunan`, `#pemda/log` |
| Pertamina (7 halaman) | `#pertamina/ringkasan`, `#pertamina/peta`, `#pertamina/terminal`, `#pertamina/armada`, `#pertamina/pengalihan`, `#pertamina/kuota`, `#pertamina/inbox` |
| POS SPBU (tablet) | `#pos` |
| Info publik (ponsel) | `#publik` |
| Hasil simulasi | `#hasil` |

Adegan siap pakai untuk tangkapan layar: tambahkan `?adegan=normal|waspada|krisis|blokir|pengalihan|respons|pulih` sebelum tanda `#` (`blokir`: POS menolak kendaraan berjeriken; `pengalihan`: permintaan pengalihan menunggu Pertamina), dan `&shot=1` untuk menyembunyikan bilah demo dan kontrol simulasi. Contoh: `index.html?adegan=krisis&shot=1#pemda/ringkasan`.

## Tes

```
node --test
```

## Lisensi pihak ketiga

- Leaflet 1.9.4, BSD-2-Clause (catatan hak cipta ada di `vendor/leaflet/leaflet.js`)
- Plus Jakarta Sans, SIL Open Font License (`vendor/fonts/OFL.txt`)
- Phosphor Icons 2.1.1, MIT (`vendor/phosphor/LICENSE`)
- Data peta © kontributor OpenStreetMap
