# Doğam Böcek İlaçlama Mobil Randevu Uygulaması

Bu klasörde telefonda kullanılabilecek basit bir mobil web uygulaması prototipi var.

## Özellikler

- Personel girişi
- Randevu listesi
- Yeni randevu kaydı
- Personel atama
- Personel ekleme
- Adresleri Google Maps'te açma
- Müşteri kartları ve geçmiş işler
- WhatsApp ve telefon bağlantıları
- İş fotoğrafı ekleme
- Müşteri imzası alma
- Konum doğrulama
- Tutar, nakit, IBAN ve borç takibi
- Rapor ekranı
- Stok yönetimi ve işten stok düşme
- Personele verilen sıvı ve jel ilaç takibi
- Veri dışa/içe aktarma
- Randevu durumunu Planlandı, Sahada veya Tamamlandı olarak değiştirme
- Tamamlanan işlerde nakit veya IBAN ödeme kaydı
- Rutin işler ekranı
- Rutin iş günü geldiğinde tarayıcı bildirimi
- Personel bazlı aktif iş sayısı
- Kayıtların cihazda saklanması

## Demo Personel PINleri

- Mahşuk Gerde: 1234
- Ali: 2222
- Servet Yılmaz: 3333

## Açma

`index.html` dosyasını tarayıcıda açabilirsiniz.

## Ortak Kullanım Modu

Ortak veritabanı için uygulamayı sunucuyla açın:

```powershell
node server.js
```

Windows'ta `node` kısayolu çalışmazsa `start-server.bat` dosyasını açın.

Sonra tarayıcıdan `http://localhost:4173` adresine girin. Aynı ağdaki telefonlar bilgisayarın yerel IP adresiyle aynı uygulamaya bağlanabilir.

Sunucu verileri `data/db.json` dosyasında tutar ve her kayıtta `data/backups` klasörüne yedek alır.

## İnternete Yayınlama

Bilgisayar kapalıyken de çalışması için uygulama bir hosting/VPS üzerine taşınmalıdır. Bu proje `npm start` ve Docker ile yayına hazırdır.

Detaylar: `DEPLOY.md`
