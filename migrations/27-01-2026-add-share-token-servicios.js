'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Agregar columnas share_token y share_token_expires_at a la tabla servicios
    await queryInterface.addColumn('servicios', 'share_token', {
      type: Sequelize.STRING(64),
      allowNull: true,
      unique: true,
      comment: 'Token único para compartir el servicio públicamente'
    });

    await queryInterface.addColumn('servicios', 'share_token_expires_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Fecha de expiración del token compartido'
    });

    console.log('✅ Columnas share_token y share_token_expires_at agregadas exitosamente');
  },

  async down(queryInterface, Sequelize) {
    // Revertir cambios eliminando las columnas
    await queryInterface.removeColumn('servicios', 'share_token_expires_at');
    await queryInterface.removeColumn('servicios', 'share_token');
    
    console.log('✅ Columnas share_token y share_token_expires_at eliminadas');
  }
};
