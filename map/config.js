// Set the require.js configuration for your application.
require.config({

  // Initialize the application with the main application file.
  deps: ["main"],

  paths: {
    // JavaScript folders.
    libs: "../assets/js/libs",
    plugins: "../assets/js/plugins",

    // Libraries.
    jquery: "../assets/js/libs/jquery",
    lodash: "../assets/js/libs/lodash",
    leaflet: "../assets/vendor/leaflet/leaflet",
    reqwest: "../assets/js/libs/reqwest",
    wax: "../assets/vendor/wax/wax.leaf"
  },

	shim: {
    'jquery': { 
      exports: '$' 
    },
    'leaflet': {
      exports: "L"
    },
    wax: {
      deps: ['leaflet', 'reqwest'],
      exports: 'Wax'
    }
	}

});
