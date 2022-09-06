(function() {
    'use strict';
    
    var fs          = require('fs'),
        ERROR_EMPTY = 'could not be empty';
    
    module.exports = function(name, data, callback) {
        if (!name)
            throw('name ' + ERROR_EMPTY);
            
        if (!data)
            throw('data ' + ERROR_EMPTY);
        
        if (!callback)
            throw('callback ' + ERROR_EMPTY);
        
        fs.readFile(name, 'utf8', function(error, result) {
            if (error && error.code !== 'ENOENT') {
                callback(error);
            } else {
                if (result)
                    data = data + '\n' + result;
                
                fs.writeFile(name, data, callback);
            }
        });
    };
    
})();
