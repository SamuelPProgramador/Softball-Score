// Reduce una imagen en el navegador y la devuelve como data URL (PNG o JPEG)
window.resizeImage = function (file, maxSize, mime, quality) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error("No se pudo leer la imagen")); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { reject(new Error("Imagen no válida")); };
      img.onload = function () {
        var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        if (mime === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL(mime || "image/png", quality || 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
};