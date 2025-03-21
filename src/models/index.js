const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');

const db = {};

// Cargar dinámicamente todos los modelos del directorio actual
fs.readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== path.basename(__filename) &&
      file.slice(-3) === '.js'
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize);
    db[model.name] = model;
  });

// Establecer asociaciones entre modelos
Object.keys(db).forEach(modelName => {

  console.log(modelName)
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;

module.exports = db;
