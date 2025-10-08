// utils/historialHelper.js

/**
 * Calcula qué campos cambiaron entre dos estados
 */
function calcularCambios(estadoAnterior, estadoNuevo, camposComparar) {
  const cambios = {
    campos_modificados: [],
    datos_anteriores: {},
    datos_nuevos: {}
  };

  camposComparar.forEach(campo => {
    const valorAnterior = estadoAnterior[campo];
    const valorNuevo = estadoNuevo[campo];

    if (JSON.stringify(valorAnterior) !== JSON.stringify(valorNuevo)) {
      cambios.campos_modificados.push(campo);
      cambios.datos_anteriores[campo] = valorAnterior;
      cambios.datos_nuevos[campo] = valorNuevo;
    }
  });

  return cambios;
}

module.exports = { calcularCambios };