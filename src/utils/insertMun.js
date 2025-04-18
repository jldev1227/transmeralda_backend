const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

// Configuración de la conexión a PostgreSQL
const pool = new Pool({
  user: 'postgres',           // Cambia esto por tu usuario
  host: 'localhost',          // Cambia si tu base de datos está en otro host
  database: 'postgres',    // Nombre de tu base de datos
  password: '1227060123',    // Tu contraseña
  port: 5432,                 // Puerto por defecto de PostgreSQL
});

/**
 * Función para normalizar los datos de un municipio
 * @param {Object} municipio - El objeto municipio del JSON
 * @returns {Object} - Objeto normalizado para inserción
 */
function normalizarMunicipio(municipio) {
  // Limpiar datos y asegurar que los formatos sean correctos
  return {
    id: uuidv4(), // Generar UUID v4
    codigo_departamento: parseInt(municipio['Código Departamento'] || '0'),
    nombre_departamento: municipio['Nombre Departamento'] || '',
    codigo_municipio: parseInt(municipio['Código Municipio'] || '0'),
    nombre_municipio: municipio['Nombre Municipio'] || '',
    tipo: municipio['Tipo: Municipio / Isla / Área no municipalizada'] || '',
    // Reemplazar comas por puntos en las coordenadas y convertir a números
    longitud: parseFloat((municipio.longitud || municipio['longitud'] || '0').toString().replace(',', '.')),
    latitud: parseFloat((municipio.Latitud || municipio['latitud'] || municipio['Latitud'] || '0').toString().replace(',', '.'))
  };
}

/**
 * Función para insertar municipios desde un archivo JSON
 * @param {string} rutaArchivo - Ruta al archivo JSON
 */
async function insertarMunicipiosDesdeJSON(rutaArchivo) {
  let client = null;
  
  try {
    // Leer el archivo JSON
    console.log(`Leyendo archivo: ${rutaArchivo}`);
    const contenidoArchivo = await fs.readFile(path.resolve(__dirname, rutaArchivo), 'utf8');
    
    // Limpiar el JSON para asegurar que sea válido
    const contenidoLimpio = contenidoArchivo
      .replace(/,\s*}/g, '}')        // Eliminar comas antes de cierre de objeto
      .replace(/,\s*\]/g, ']')       // Eliminar comas antes de cierre de array
      .replace(/([{,]\s*)([a-zA-Z]+)(\s*:)/g, '$1"$2"$3'); // Agregar comillas a claves sin comillas
    
    // Intentar parsear el JSON
    let municipios;
    try {
      municipios = JSON.parse(contenidoLimpio);
    } catch (error) {
      console.error('Error al parsear JSON:', error.message);
      console.log('Intentando método alternativo de parseo...');
      
      // Si falla, intentamos un método más flexible (solo para desarrollo, no recomendado para producción)
      const funcionTemporal = new Function(`return ${contenidoLimpio}`);
      municipios = funcionTemporal();
    }
    
    // Asegurarnos de que tenemos un array
    if (!Array.isArray(municipios)) {
      municipios = [municipios];
    }
    
    console.log(`Se encontraron ${municipios.length} municipios para insertar`);
    
    // Obtener un cliente desde el pool
    client = await pool.connect();
    
    // Verificar la estructura de la tabla para ver qué campos existen
    console.log('Verificando estructura de la tabla municipios...');
    const tableInfo = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'municipios'
    `);
    
    console.log(`La tabla tiene ${tableInfo.rows.length} columnas`);
    
    // Comprobar si existen las columnas de timestamp
    const columnas = tableInfo.rows.map(row => row.column_name);
    const tieneCreatedAt = columnas.includes('created_at');
    const tieneUpdatedAt = columnas.includes('updated_at');
    
    console.log(`Columna created_at: ${tieneCreatedAt ? '✅ Presente' : '❌ No existe'}`);
    console.log(`Columna updated_at: ${tieneUpdatedAt ? '✅ Presente' : '❌ No existe'}`);
    
    // Preparar consulta SQL para inserción o actualización (upsert) con timestamps
    const ahora = new Date().toISOString();
    
    // Construir la consulta dinámicamente según las columnas existentes
    let queryText = `
      INSERT INTO municipios(
        id, codigo_departamento, nombre_departamento, codigo_municipio, 
        nombre_municipio, tipo, longitud, latitud
    `;
    
    // Agregar columnas de timestamp si existen
    if (tieneCreatedAt) queryText += `, created_at`;
    if (tieneUpdatedAt) queryText += `, updated_at`;
    
    queryText += `) VALUES($1, $2, $3, $4, $5, $6, $7, $8`;
    
    // Agregar valores para las columnas de timestamp
    let paramCount = 8;
    if (tieneCreatedAt) queryText += `, $${++paramCount}`;
    if (tieneUpdatedAt) queryText += `, $${++paramCount}`;
    
    queryText += `)
      ON CONFLICT (codigo_municipio) 
      DO UPDATE SET 
        codigo_departamento = EXCLUDED.codigo_departamento,
        nombre_departamento = EXCLUDED.nombre_departamento,
        nombre_municipio = EXCLUDED.nombre_municipio,
        tipo = EXCLUDED.tipo,
        longitud = EXCLUDED.longitud,
        latitud = EXCLUDED.latitud
    `;
    
    // Agregar actualización de updated_at si existe
    if (tieneUpdatedAt) {
      queryText += `, updated_at = EXCLUDED.updated_at`;
    }
    
    // Procesar cada municipio individualmente
    let exitosos = 0;
    let fallidos = 0;
    
    for (const municipio of municipios) {
      try {
        // Comenzar una transacción para cada municipio
        await client.query('BEGIN');
        
        const municipioNormalizado = normalizarMunicipio(municipio);
        
        // Verificar valores antes de insertar
        console.log(`Procesando municipio: ${municipioNormalizado.nombre_municipio}`);
        console.log(`  ID: ${municipioNormalizado.id}`);
        console.log(`  Código: ${municipioNormalizado.codigo_municipio}`);
        console.log(`  Coordenadas: ${municipioNormalizado.longitud}, ${municipioNormalizado.latitud}`);
        
        // Preparar parámetros para la consulta
        const params = [
          municipioNormalizado.id,
          municipioNormalizado.codigo_departamento,
          municipioNormalizado.nombre_departamento,
          municipioNormalizado.codigo_municipio,
          municipioNormalizado.nombre_municipio,
          municipioNormalizado.tipo,
          municipioNormalizado.longitud,
          municipioNormalizado.latitud
        ];
        
        // Agregar timestamps si existen las columnas
        if (tieneCreatedAt) params.push(ahora);
        if (tieneUpdatedAt) params.push(ahora);
        
        await client.query(queryText, params);
        
        // Confirmar transacción para este municipio
        await client.query('COMMIT');
        
        exitosos++;
        console.log(`  ✅ Municipio insertado/actualizado correctamente`);
        
      } catch (error) {
        // Si hay un error, revertir solo la transacción actual
        await client.query('ROLLBACK');
        
        fallidos++;
        console.error(`  ❌ Error al insertar municipio:`, municipio);
        console.error(`  Mensaje de error: ${error.message}`);
        
        // Verificar si hay problemas específicos de conversión de datos
        if (error.message.includes('invalid input syntax')) {
          console.error('  Problema de conversión de tipos. Revisa los datos.');
          
          // Mostrar valores problemáticos
          console.error(`  Valores originales: longitud=${municipio.longitud || municipio['longitud']}, latitud=${municipio.Latitud || municipio['latitud'] || municipio['Latitud']}`);
        }
      }
    }
    
    console.log(`\nProceso completado:`);
    console.log(`  ✅ Exitosos: ${exitosos} municipios`);
    console.log(`  ❌ Fallidos: ${fallidos} municipios`);
    
  } catch (error) {
    console.error('Error general al procesar el archivo JSON:', error.message);
    throw error;
  } finally {
    // Liberar el cliente de vuelta al pool
    if (client) {
      client.release();
    }
    // Cerrar el pool de conexiones
    await pool.end();
  }
}

// Script principal
(async () => {
  try {
    if (process.argv.length < 3) {
      console.log('Uso: node script.js ruta/al/archivo.json');
      process.exit(1);
    }
    
    const rutaArchivo = process.argv[2];
    await insertarMunicipiosDesdeJSON(rutaArchivo);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();