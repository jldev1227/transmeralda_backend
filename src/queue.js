// queue.js - Configuración de la cola
const Queue = require('bull');
const Redis = require('ioredis');
const axios = require('axios');
const FormData = require('form-data');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

// Configuración de Redis
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
};

// Cliente Redis para almacenamiento de datos
const redisClient = new Redis(redisConfig);

// Cola para procesar documentos
const documentQueue = new Queue('document-processing', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: false
  }
});

// Cola para la validación final y creación del vehículo
const vehicleCreationQueue = new Queue('vehicle-creation', {
  redis: redisConfig
});

// Configuración para OCR
const documentIntelligenceEndpoint = process.env.DOC_INTELLIGENCE;
const subscriptionKey = process.env.DOC_INTELLIGENCE_KEY;

// Mapeo de categorías a nombres de scripts
const scriptMapping = {
  'TARJETA_DE_PROPIEDAD': 'ocrTARJETA_DE_PROPIEDAD.py',
  'SOAT': 'ocrSOAT.py',
  'TECNOMECÁNICA': 'ocrTECNOMECANICA.py',
  'TARJETA_DE_OPERACIÓN': 'ocrTARJETA_DE_OPERACION.py',
  'POLIZA_CONTRACTUAL': 'ocrPOLIZA_CONTRACTUAL.py',
  'POLIZA_EXTRACONTRACTUAL': 'ocrPOLIZA_EXTRACONTRACTUAL.py',
  'POLIZA_TODO_RIESGO': 'ocrPOLIZA_TODO_RIESGO.py'
};

// Funciones auxiliares
async function waitForOcrResult(operationLocation, subscriptionKey) {
  let status = 'running';
  let result;

  while (status === 'running' || status === 'notStarted') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const response = await axios.get(operationLocation, {
      headers: {
        'Ocp-Apim-Subscription-Key': subscriptionKey
      }
    });

    status = response.data.status;
    if (status === 'succeeded') {
      result = response.data;
    }
  }

  return result;
}

// Función para procesar documentos con scripts Python
async function runOcrScript(category, scriptName, placa = null) {
  return new Promise((resolve, reject) => {
    // Configurar el proceso Python solo con los argumentos necesarios
    const args = [`./src/scripts/${scriptName}`];
    
    // Solo pasar la placa si es necesaria
    if (placa) {
      args.push(placa);
      console.log(placa)
    }
    
    const pythonProcess = spawn('python', args);
    
    let result = '';
    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
      console.log(`[Python Output] ${category} ${data.toString().trim()}`);
    });
    
    pythonProcess.stderr.on('data', (data) => {
      console.error(`Error en script de Python (${category}):`, data.toString());
    });
    
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const parsedResult = JSON.parse(result);
          resolve(parsedResult);
        } catch (error) {
          reject(new Error(`Error al parsear resultado de script (${category}): ${error.message}`));
        }
      } else {
        reject(new Error(`Script falló con código ${code} (${category})`));
      }
    });
  });
}

// Función para guardar y luego eliminar archivos temporales
async function procesarConArchivoTemporal(categoria, scriptName, ocrData, placa = null) {
  const dirPath = path.join(__dirname, 'utils');
  const filePath = path.join(dirPath, `tempOcrData${categoria}.json`);

  try {
    // Crear directorio si no existe
    await fs.mkdir(dirPath, { recursive: true });
    
    // Guardar datos OCR en formato JSON
    await fs.writeFile(filePath, JSON.stringify(ocrData, null, 2), 'utf8');
    
    // Ejecutar script Python (ya no pasamos los datos OCR)
    const resultado = await runOcrScript(categoria, scriptName, placa);
    
    // Eliminar archivo temporal después de usarlo
    try {
      await fs.unlink(filePath);
      console.log(`Archivo temporal eliminado: ${filePath}`);
    } catch (unlinkError) {
      console.warn(`No se pudo eliminar el archivo temporal: ${unlinkError.message}`);
    }
    
    return resultado;
    
  } catch (error) {
    // Intentar eliminar el archivo temporal incluso si ocurrió un error
    try {
      await fs.unlink(filePath);
    } catch (unlinkError) {
      // Ignorar error si no se puede eliminar
    }
    
    throw error;
  }
}

// Función para validar que la placa del documento coincida con la del vehículo
function validarPlaca(placaDocumento, placaVehiculo, categoria) {
  if (!placaDocumento) return;

  // Normalizar placas para comparación (quitar espacios, guiones, etc.)
  const normalizedPlacaDoc = placaDocumento.replace(/[\s-]/g, '').toUpperCase();
  const normalizedPlacaVeh = placaVehiculo.replace(/[\s-]/g, '').toUpperCase();

  if (normalizedPlacaDoc !== normalizedPlacaVeh) {
    throw new Error(`La placa del documento ${categoria} (${placaDocumento}) no coincide con la placa del vehículo (${placaVehiculo})`);
  }
}

// Función para iniciar el procesamiento de documentos
async function procesarDocumentos(files, categorias, socketId) {
  try {
    const sessionId = uuidv4();
    const totalFiles = files.length;

    // Guardar información de la sesión
    // Usa esto (compatible con Redis 3.0.x):
    await redisClient.hset(`vehiculo:${sessionId}`, 'totalDocumentos', totalFiles);
    await redisClient.hset(`vehiculo:${sessionId}`, 'procesados', 0);
    await redisClient.hset(`vehiculo:${sessionId}`, 'socketId', socketId);
    await redisClient.hset(`vehiculo:${sessionId}`, 'estado', 'en_proceso');

    // Añadir primero la Tarjeta de Propiedad a la cola
    const tarjetaPropiedadIndex = categorias.findIndex(cat => cat === 'TARJETA_DE_PROPIEDAD');

    if (tarjetaPropiedadIndex !== -1) {
      await documentQueue.add('procesar-documento', {
        file: files[tarjetaPropiedadIndex],
        categoria: categorias[tarjetaPropiedadIndex],
        sessionId,
        esTarjetaPropiedad: true,
        index: tarjetaPropiedadIndex
      }, { priority: 1 }); // Alta prioridad para tarjeta de propiedad
    } else {
      throw new Error('La Tarjeta de Propiedad es obligatoria');
    }

    // Añadir el resto de documentos a la cola
    for (let i = 0; i < files.length; i++) {
      if (i !== tarjetaPropiedadIndex) {
        await documentQueue.add('procesar-documento', {
          file: files[i],
          categoria: categorias[i],
          sessionId,
          esTarjetaPropiedad: false,
          index: i
        }, { priority: 10 }); // Menor prioridad para otros documentos
      }
    }

    return sessionId;
  } catch (error) {
    console.error('Error al iniciar procesamiento:', error);
    throw error;
  }
}

// Procesar cada documento individualmente
documentQueue.process('procesar-documento', async (job) => {
  const { file, categoria, sessionId, esTarjetaPropiedad } = job.data;
  try {
    // Actualizar progreso
    job.progress(10);
    
    // Si no es la tarjeta de propiedad, primero obtener la placa del vehículo
    let placaVehiculo = null;
    if (!esTarjetaPropiedad) {
      // Intentar obtener los datos de la tarjeta con reintentos
      let intentos = 0;
      let tarjetaPropiedadData = null;
      while (intentos < 5 && !tarjetaPropiedadData) {
        // recuperar datos de la tarjeta de propiedad desde Redis, usando el sessionId
        tarjetaPropiedadData = await redisClient.hget(`vehiculo:${sessionId}:documentos`, 'TARJETA_DE_PROPIEDAD');
        if (!tarjetaPropiedadData) {
          // Esperar 2 segundos antes de reintentar
          await new Promise(resolve => setTimeout(resolve, 2000));
          intentos++;
        }
      }
      if (!tarjetaPropiedadData) {
        throw new Error(`No se pudo obtener datos de la tarjeta de propiedad después de ${intentos} intentos`);
      }
      const parsedData = JSON.parse(tarjetaPropiedadData);
      placaVehiculo = parsedData.placa;
    }
    
    // Enviar archivo a OCR
    const form = new FormData();
    form.append(categoria, Buffer.from(file.buffer), {
      filename: file.filename,
      contentType: file.mimetype,
    });
    
    const response = await axios.post(documentIntelligenceEndpoint, form, {
      headers: {
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        ...form.getHeaders(),
      },
    });
    
    // Actualizar progreso
    job.progress(30);
    
    // Esperar resultado del OCR
    const operationLocation = response.headers['operation-location'];
    const ocrData = await waitForOcrResult(operationLocation, subscriptionKey);
    
    // Actualizar progreso
    job.progress(60);
    
    // Crear directorio y guardar temporalmente los datos OCR
    const dirPath = path.join(__dirname, 'utils');
    await fs.mkdir(dirPath, { recursive: true });
    
    // Ruta del archivo temporal
    const filePath = path.join(dirPath, `tempOcrData${categoria}.json`);
    
    // Guardar datos OCR en formato JSON
    await fs.writeFile(filePath, JSON.stringify(ocrData, null, 2), 'utf8');
    
    // Determinar qué script usar
    const scriptName = scriptMapping[categoria];
    
    // Ejecutar script Python con los datos OCR y la placa si es necesario
    const resultado = await procesarConArchivoTemporal(categoria, scriptName, ocrData, esTarjetaPropiedad ? null : placaVehiculo);
    console.log(`Documento ${categoria} procesado y guardado en Redis0`);
    
    // Actualizar progreso
    job.progress(90);
    
    // Guardar resultado en Redis
    await redisClient.hset(`vehiculo:${sessionId}:documentos`, categoria, JSON.stringify(resultado));
    
    // Incrementar contador de documentos procesados
    const procesados = await redisClient.hincrby(`vehiculo:${sessionId}`, 'procesados', 1);
    const total = await redisClient.hget(`vehiculo:${sessionId}`, 'totalDocumentos');
    
    console.log(`Documento ${categoria} procesado y guardado en Redis1`);
    // Emitir evento de progreso a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    global.io.to(socketId).emit('documento-procesado', {
      categoria,
      progreso: Math.floor((procesados / total) * 100),
      completado: procesados === parseInt(total)
    });
    
    // Si todos los documentos han sido procesados, programar la creación del vehículo
    if (procesados === parseInt(total)) {
      await vehicleCreationQueue.add('crear-vehiculo', { sessionId });
    }
    
    // Actualizar progreso
    job.progress(100);
    console.log(`Documento ${categoria} procesado y guardado en Redis`);
    return { success: true, categoria };
  } catch (error) {
    // Marcar sesión como fallida
    await redisClient.hset(`vehiculo:${sessionId}`, 'estado', 'fallido', 'error', error.message);
    
    // Notificar error a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    global.io.to(socketId).emit('error-procesamiento', {
      categoria,
      mensaje: error.message
    });
    
    throw error;
  }
});

// Procesar la creación final del vehículo
vehicleCreationQueue.process('crear-vehiculo', async (job) => {
  const { sessionId } = job.data;
  try {
    // Obtener todos los datos procesados
    const documentosData = await redisClient.hgetall(`vehiculo:${sessionId}:documentos`);

    // Verificar que tengamos la tarjeta de propiedad
    if (!documentosData['TARJETA_DE_PROPIEDAD']) {
      throw new Error('Falta la Tarjeta de Propiedad procesada');
    }

    const tarjetaDePropiedad = JSON.parse(documentosData['TARJETA_DE_PROPIEDAD']);
    const datos = { ...tarjetaDePropiedad };

    // Mapeo de claves para fechas de vencimiento
    const mapeoFechas = {
      'SOAT': 'soatVencimiento',
      'TECNOMECÁNICA': 'tecnomecanicaVencimiento',
      'TARJETA_DE_OPERACIÓN': 'tarjetaDeOperacionVencimiento',
      'POLIZA_CONTRACTUAL': 'polizaContractualVencimiento',
      'POLIZA_EXTRACONTRACTUAL': 'polizaExtracontractualVencimiento',
      'POLIZA_TODO_RIESGO': 'polizaTodoRiesgoVencimiento'
    };

    // Agregar fechas de vencimiento al objeto de datos
    for (const [categoria, documento] of Object.entries(documentosData)) {
      if (categoria === 'TARJETA_DE_PROPIEDAD') continue;

      const parsedDoc = JSON.parse(documento);
      if (mapeoFechas[categoria] && parsedDoc) {
        // Validar placa si existe
        if (parsedDoc.placa) {
          validarPlaca(parsedDoc.placa, tarjetaDePropiedad.placa, categoria);
        }

        // Añadir fecha de vencimiento
        datos[mapeoFechas[categoria]] = parsedDoc[mapeoFechas[categoria]] || null;
      }
    }

    // Aquí deberías crear el vehículo en tu base de datos
    // const nuevoVehiculo = await Vehiculo.create(datos);

    // Para este ejemplo, asumimos que el vehículo se creó correctamente
    const nuevoVehiculo = { ...datos, id: uuidv4() };

    // Actualizar estado en Redis
    await redisClient.hset(
      `vehiculo:${sessionId}`,
      'estado', 'completado',
      'vehiculoId', nuevoVehiculo.id
    );

    // Notificar a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    global.io.to(socketId).emit('vehiculo-creado', {
      success: true,
      vehiculo: nuevoVehiculo,
      mensaje: 'Vehículo creado exitosamente'
    });

    return { success: true, vehiculo: nuevoVehiculo };
  } catch (error) {
    console.error('Error al crear vehículo:', error);

    // Marcar sesión como fallida
    await redisClient.hset(`vehiculo:${sessionId}`, 'estado', 'fallido', 'error', error.message);

    // Notificar error a través de WebSocket
    const socketId = await redisClient.hget(`vehiculo:${sessionId}`, 'socketId');
    global.io.to(socketId).emit('error-procesamiento', {
      etapa: 'creacion-vehiculo',
      mensaje: error.message
    });

    throw error;
  }
});

module.exports = {
  procesarDocumentos,
  documentQueue,
  vehicleCreationQueue
};