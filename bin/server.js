// Handle data path
var path = require('path'),
  fs = require('fs'),
  express = require('express'),
  bodyParser = require('body-parser'),
  gzipStatic = require('connect-gzip-static'),
  httpProxy = require('http-proxy'),
  preCheckDataDir = require('./arctic-dataset-list-builder'),
  tenSeconds = 10000;

module.exports = function(dataPath, clientConfiguration) {
  // for electron
  if (!clientConfiguration) {
    clientConfiguration = {
      MagicLens: false,
      SingleView: false,
      Recording: false,
      Development: false
    };
  }
  var needProxy = (dataPath.indexOf('http') === 0);

  // Handle relative path
  if(dataPath[0] === '.') {
      dataPath = path.normalize(path.join(process.env.PWD, dataPath));
  }

  // Build request handling
  var app = express();
  // - static HTML + JS
  app.use(express.static(__dirname + "/../dist"));

  // For each route and use Express adds a Layer type to the router stack
  // here we remove it so that we can replace it later.
  // Layer { handle: fn, name: fn.name || <anonymous>, params: {}, path: urlPath,
  //         keys: [], regexp: path regexp, route: Route object }
  app.removeLayer = function(urlPath) {
    var layerIndex = -1;
    for (var i = 0; i < app._router.stack.length; i++) {
      if (app._router.stack[i].path === urlPath) {
        layerIndex = i;
        break;
      }
    }

    if (layerIndex === -1) {
      console.log(`Router layer for '${urlPath}' not found`);
      return;
    }

    app._router.stack.splice(layerIndex, 1);
  }

  app.updateDataPath = function (newDataPath) {
    app.removeLayer('/data');
    app.dataPath = newDataPath;
    // - Handle data
    if (needProxy) {
      // Need to proxy the data directory
      var proxy = httpProxy.createProxyServer({});
      app.use('/data', function data(req, res) {
        proxy.web(req, res, {
          target: app.dataPath,
          changeOrigin: true,
        });
      });
    } else {
      // Handle the case we provide a file instead of directory
      if (!fs.statSync(app.dataPath).isDirectory()) {
        app.dataPath = path.dirname(app.dataPath);
      }

      // Build Dataset list if need be
      preCheckDataDir(app.dataPath);

      // Serve data from static content
      app.use('/data', gzipStatic(app.dataPath, { maxAge: tenSeconds }));
    }
  };

  app.updateDataPath(dataPath);

  // Add image export handler
  app.use(bodyParser.json({limit: 10000000}));
  app.post('/export', function(req, res) {
      var data = req.body,
          args = data.arguments,
          base64Data = extractImageBase64(data.image);

      if (base64Data) {
          fs.writeFile(getExportPath(args), base64Data, 'base64', function(err) {
          });
      } else {
          // We should get the URL of image and copy it with a different name
      }

      res.send('Data saved');
  });

  // Add metadata update
  app.post('/update', function(req, res) {
      var data = req.body,
          title = data.title.replace(/<br>/g, '').replace(/<br\/>/g, ''),
          description = data.description.replace(/<br>/g, '').replace(/<br\/>/g, ''),
          dsPath = path.join(app.dataPath, removeHead(data.path, '/data/')),
          imagePath = data.image,
          base64Data = extractImageBase64(data.image);

      // Create thumbnail
      if (base64Data) {
          // Write thumbnail as base64
          var thumbnailPath = path.join(dsPath, 'thumbnail.png');
          fs.writeFile(thumbnailPath, base64Data, 'base64', function(err) {});
      } else {
          // Copy image
          console.log('Should copy image: ', imagePath);
      }

      // Update index.json
      var indexPath = path.join(dsPath, 'index.json'),
          originalData = require(indexPath);

      if (!originalData.metadata) {
          originalData.metadata = {};
      }

      originalData.metadata.title = title;
      originalData.metadata.description = description;
      fs.writeFile(indexPath, JSON.stringify(originalData, null, 2));

      res.send('Data updated');
  });

  // Add config.json endpoint
  app.get('/config.json', function(req, res) {
      res.send(JSON.stringify(clientConfiguration, null, 2));
  });

  return app;
};
