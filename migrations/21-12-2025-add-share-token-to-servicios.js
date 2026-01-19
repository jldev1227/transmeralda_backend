/**
 * Migración: Agregar campos de compartir público a servicios
 * Fecha: 21-12-2025
 * 
 * Agrega los campos share_token y share_token_expires_at a la tabla servicios
 * para permitir compartir servicios mediante enlaces públicos.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('🔧 Agregando campos de compartir público a tabla servicios...');

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

    // Crear índice para búsquedas rápidas por token
    await queryInterface.addIndex('servicios', ['share_token'], {
      name: 'servicios_share_token_idx',
      unique: true,
      where: {
        share_token: {
          [Sequelize.Op.ne]: null
        }
      }
    });

    console.log('✅ Campos de compartir público agregados correctamente');
  },

  down: async (queryInterface, Sequelize) => {
    console.log('🔧 Eliminando campos de compartir público de tabla servicios...');

    // Eliminar índice primero
    await queryInterface.removeIndex('servicios', 'servicios_share_token_idx');

    // Eliminar columnas
    await queryInterface.removeColumn('servicios', 'share_token_expires_at');
    await queryInterface.removeColumn('servicios', 'share_token');

    console.log('✅ Campos de compartir público eliminados correctamente');
  }
};
