# Doğam Uygulamasını İnternete Yayınlama

Bu proje artık buluta taşınabilir durumdadır. Sunucu `server.js` dosyasıyla çalışır, veriyi JSON veritabanı olarak saklar.

## Önemli

Kalıcı veri için hostingte mutlaka bir disk/volume bağlayın ve `DATA_DIR` değerini o klasöre verin. Aksi halde bazı hostinglerde uygulama yeniden başlatılınca kayıtlar sıfırlanabilir.

## Gerekli Ortam Değişkenleri

- `PORT`: Hosting otomatik veriyorsa elle girmenize gerek yoktur.
- `DATA_DIR`: Kalıcı veri klasörü. Örnek: `/data`

## Render ile Yayınlama

Projede `render.yaml` hazırdır. Render üzerinde Blueprint veya Web Service oluştururken:

- Build Command: boş bırakın
- Start Command: `npm start`
- Environment: `Node`
- Disk: `/var/data`
- Environment variable: `DATA_DIR=/var/data`

## Çalıştırma

```bash
npm start
```

## Docker ile Yayınlama

```bash
docker build -t dogam-saha-paneli .
docker run -p 4173:4173 -v dogam-data:/data dogam-saha-paneli
```

## VPS ile Yayınlama

1. Sunucuya Node.js 20 veya üstünü kurun.
2. Proje dosyalarını sunucuya yükleyin.
3. Kalıcı veri klasörü oluşturun:

```bash
mkdir -p /opt/dogam-data
```

4. Uygulamayı çalıştırın:

```bash
DATA_DIR=/opt/dogam-data PORT=4173 npm start
```

5. Alan adı kullanacaksanız Nginx ile HTTPS yönlendirmesi yapın.

## Veri Yedeği

Sunucu her kayıt işleminde `DATA_DIR/backups` içine otomatik yedek alır.

## Mevcut Veriyi Taşıma

Uygulamadaki `Veri` ekranından dışa aktarın. Buluttaki uygulamayı açınca aynı ekrandan içe aktarın.
