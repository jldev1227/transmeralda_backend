const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { S3Client, GetObjectCommand,
    DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');
const fs = require('fs').promises;
const { Documento } = require('../models');
const logger = require('../utils/logger');
const { redisClient } = require('../config/redisClient');
// Asegúrate de importar el comando DeleteObjectCommand

// Cliente S3
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-2',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'transmeralda';

/**
 * Guarda un documento temporalmente en el sistema de archivos local
 * @param {Object} file - Objeto del archivo (buffer, filename, mimetype)
 * @param {string} sessionId - ID de la sesión
 * @param {string} categoria - Categoría del documento
 * @returns {Promise<string>} - Ruta al archivo guardado
 */

async function saveTemporaryDocument(file, sessionId, categoria) {
    try {
        // PASO 1: Convertir el objeto buffer a un Buffer real de Node.js
        let bufferToWrite;

        if (Buffer.isBuffer(file.buffer)) {
            // Si ya es un Buffer, úsalo directamente
            bufferToWrite = file.buffer;
        } else if (file.buffer && file.buffer.type === 'Buffer' && Array.isArray(file.buffer.data)) {
            // Si es un objeto con estructura {type: 'Buffer', data: [...]} 
            // (resultado de Buffer.toJSON() o serialización)
            bufferToWrite = Buffer.from(file.buffer.data);
            logger.info(`Buffer convertido correctamente para ${file.filename}, tamaño: ${bufferToWrite.length} bytes`);
        } else {
            // Si no tenemos un buffer válido, lanzar error
            logger.error(`Error: formato de buffer inválido para ${file.filename || 'sin nombre'}`);
            throw new Error('El formato del buffer no es válido');
        }

        // PASO 2: Verificar que el buffer tiene contenido
        if (!bufferToWrite || bufferToWrite.length === 0) {
            logger.error(`Error: El archivo ${file.filename || 'sin nombre'} tiene un buffer vacío`);
            throw new Error('El archivo recibido está vacío');
        }

        // PASO 3: Crear directorio temporal si no existe
        const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);
        await fs.mkdir(tempDir, { recursive: true });

        // PASO 4: Generar nombre de archivo único
        const timestamp = Date.now();
        const filename = `${timestamp}-${categoria}-${file.filename || 'document.pdf'}`;
        const filePath = path.join(tempDir, filename);

        // PASO 5: Guardar el archivo con el buffer correcto
        await fs.writeFile(filePath, bufferToWrite);

        // PASO 6: Verificar que el archivo se guardó correctamente
        const stats = await fs.stat(filePath);
        logger.info(`Archivo temporal guardado: ${filePath}, tamaño: ${stats.size} bytes`);

        if (stats.size === 0) {
            logger.error(`Error: El archivo se guardó con 0 bytes: ${filePath}`);
            throw new Error('El archivo se guardó con 0 bytes');
        }

        // PASO 7: Retornar la información del archivo correcta
        return {
            path: filePath,
            originalname: file.filename,
            mimetype: file.mimetype,
            size: bufferToWrite.length
        };
    } catch (error) {
        logger.error(`Error al guardar documento temporal: ${error.message}`);
        throw error;
    }
}

/**
 * Sube documentos finales a S3 después de procesar un vehículo exitosamente
 * Esta función puede usarse tanto para creación como para actualización de documentos
 * @param {string} sessionId - ID de la sesión
 * @param {string} vehiculoId - ID del vehículo
 * @param {Date} fechaVigencia - Indica si es una actualización (true) o creación (false)
 * @param {boolean} isUpdate - Indica si es una actualización (true) o creación (false)
 * @returns {Promise<Array>} - Array de documentos creados
 */
async function uploadProcessedDocumentsVehiculo(sessionId, vehiculoId, fechasVigencia, isUpdate = false, categorias = []) {
    const documentosCreados = [];
    const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);

    try {
        // Verificar que el directorio existe
        const exists = await fs.access(tempDir).then(() => true).catch(() => false);
        if (!exists) {
            logger.warn(`Directorio temporal no encontrado: ${tempDir}`);
            return documentosCreados;
        }

        // Si es una actualización, eliminar SOLO los documentos de las categorías que se están actualizando
        if (isUpdate && categorias && categorias.length > 0) {
            try {
                logger.info(`Eliminando documentos antiguos para vehículo ${vehiculoId} en categorías: ${categorias.join(', ')}`);

                // Buscar solo documentos de las categorías específicas
                const documentosAntiguos = await Documento.findAll({
                    where: {
                        vehiculo_id: vehiculoId,
                        categoria: categorias // Solo documentos de las categorías que se van a actualizar
                    }
                });

                logger.info(`Encontrados ${documentosAntiguos.length} documentos antiguos para eliminar`);

                // Eliminar archivos de S3
                for (const doc of documentosAntiguos) {
                    try {
                        // Solo eliminar de S3 si existe la key
                        if (doc.s3_key) {
                            const deleteCommand = {
                                Bucket: BUCKET_NAME,
                                Key: doc.s3_key
                            };

                            await s3Client.send(new DeleteObjectCommand(deleteCommand));
                            logger.info(`Documento eliminado de S3: ${doc.s3_key} (categoría: ${doc.categoria})`);
                        }
                    } catch (s3Error) {
                        logger.warn(`Error al eliminar documento de S3 (${doc.s3_key}): ${s3Error.message}`);
                        // Continuar con el siguiente aunque haya errores
                    }
                }

                // Eliminar registros de la base de datos solo de las categorías específicas
                if (documentosAntiguos.length > 0) {
                    await Documento.destroy({
                        where: {
                            vehiculo_id: vehiculoId,
                            categoria: categorias
                        }
                    });
                    logger.info(`Se eliminaron ${documentosAntiguos.length} documentos antiguos de categorías ${categorias.join(', ')} para vehículo ${vehiculoId}`);
                }
            } catch (deleteError) {
                logger.error(`Error al eliminar documentos antiguos: ${deleteError.message}`);
                // Continuamos con la subida de los nuevos aunque haya errores
            }
        }

        // Obtener información de documentos desde Redis
        const fileInfoKeys = await redisClient.keys(`vehiculo:${sessionId}:files:*`);

        for (const key of fileInfoKeys) {
            try {
                // Extraer categoría del documento de la clave de Redis
                const categoria = key.split(':').pop();
                const fileInfoStr = await redisClient.get(key);
                logger.info(`Datos de Redis para ${key}: ${fileInfoStr}`);

                if (!fileInfoStr) {
                    logger.warn(`No se encontraron datos en Redis para la clave ${key}`);
                    continue;
                }

                try {
                    const fileInfo = JSON.parse(fileInfoStr);
                    logger.info(`Información del archivo parseada: ${JSON.stringify(fileInfo)}`);

                    // Verificar que la información del archivo es completa
                    if (!fileInfo.path) {
                        logger.warn(`No se encontró ruta para documento ${categoria}`);
                        continue;
                    }

                    // Verificar que el archivo existe en el sistema
                    const fileExists = await fs.access(fileInfo.path).then(() => true).catch(() => false);
                    if (!fileExists) {
                        logger.warn(`El archivo ${fileInfo.path} no existe en el sistema`);
                        continue;
                    }

                    // Leer el archivo
                    const fileContent = await fs.readFile(fileInfo.path);
                    logger.info(`Archivo leído: ${fileInfo.path}`);
                    logger.info(`Tamaño del archivo a subir: ${fileContent.length} bytes`);

                    // Si el tamaño es 0, añade un log de advertencia
                    if (fileContent.length === 0) {
                        logger.warn(`¡ALERTA! Archivo con 0 bytes: ${fileInfo.path}`);
                        continue; // Saltar archivos vacíos
                    }

                    // Generar ID único para el documento
                    const documentId = uuidv4();

                    // Generar ruta en S3
                    const s3Key = `vehiculos/${vehiculoId}/documentos/${categoria}/${documentId}${path.extname(fileInfo.originalname || 'documento.pdf')}`;

                    // Verificar que hay contenido para subir
                    if (!fileContent || fileContent.length === 0) {
                        logger.error(`No se puede subir archivo vacío a S3: ${s3Key}`);
                        throw new Error(`El archivo ${fileInfo.path} está vacío y no se puede subir a S3`);
                    }

                    // Verificar conexión a S3 antes de subir
                    try {
                        logger.info(`Iniciando subida a S3: ${s3Key}, tamaño: ${fileContent.length} bytes`);

                        // Subir a S3 con manejo de errores mejorado
                        const upload = new Upload({
                            client: s3Client,
                            params: {
                                Bucket: BUCKET_NAME,
                                Key: s3Key,
                                Body: fileContent,
                                ContentType: fileInfo.mimetype || 'application/octet-stream',
                                // Añadir metadatos adicionales si es necesario
                                Metadata: {
                                    'original-filename': fileInfo.originalname || `${categoria}.pdf`,
                                    'document-category': categoria,
                                    'vehiculo-id': vehiculoId,
                                    'file-size': String(fileContent.length)
                                }
                            }
                        });

                        const result = await upload.done();
                        logger.info(`Subida exitosa a S3: ${s3Key}, ETag: ${result.ETag}`);
                    } catch (s3Error) {
                        logger.error(`Error al subir a S3: ${s3Error.message}`);
                        // Verificar credenciales de AWS
                        if (s3Error.message.includes('credentials')) {
                            logger.error('Posible problema con las credenciales de AWS');
                        }
                        throw s3Error;
                    }

                    // ✅ CORREGIDO: Buscar fecha de vigencia por categoría o usar null
                    let fechaVigencia = null;
                    if (fechasVigencia) {
                        // Buscar coincidencia exacta primero
                        if (fechasVigencia[categoria]) {
                            fechaVigencia = fechasVigencia[categoria];
                        } else {
                            // Buscar coincidencias parciales o mapear categorías
                            const categoriaMapping = {
                                'TARJETA_DE_PROPIEDAD': ['TARJETA_PROPIEDAD', 'PROPIEDAD'],
                                'SOAT': ['SOAT'],
                                'REVISION_TECNICO_MECANICA': ['RTM', 'TECNICOMECANICA', 'REVISION_TECNICA'],
                                'LICENCIA_TRANSITO': ['LICENCIA', 'TRANSITO']
                            };

                            // Buscar en el mapping
                            for (const [key, aliases] of Object.entries(categoriaMapping)) {
                                if (aliases.includes(categoria) && fechasVigencia[key]) {
                                    fechaVigencia = fechasVigencia[key];
                                    break;
                                }
                            }

                            // Si no encuentra por mapping, buscar por clave que contenga la categoría
                            if (!fechaVigencia) {
                                const fechaKey = Object.keys(fechasVigencia).find(key =>
                                    key.toLowerCase().includes(categoria.toLowerCase()) ||
                                    categoria.toLowerCase().includes(key.toLowerCase())
                                );
                                if (fechaKey) {
                                    fechaVigencia = fechasVigencia[fechaKey];
                                }
                            }
                        }
                    }

                    // Crear registro en la base de datos
                    const documento = await Documento.create({
                        id: documentId,
                        vehiculo_id: vehiculoId,

                        // ✅ Campos obligatorios del modelo
                        categoria: categoria,
                        nombre_original: fileInfo.originalname || `${categoria}.pdf`,
                        nombre_archivo: `${documentId}${path.extname(fileInfo.originalname || '.pdf')}`,
                        ruta_archivo: s3Key, // En este caso, la "ruta" es la key de S3
                        size: fileInfo.size || 0,
                        estado: 'vigente', // Asignar estado por defecto, puede ser actualizado después
                        mimetype: fileInfo.mimetype || 'application/octet-stream',

                        // ✅ Campos opcionales
                        s3_key: s3Key,
                        filename: fileInfo.originalname || `${categoria}.pdf`,
                        fecha_vigencia: fechaVigencia ? new Date(fechaVigencia) : null,
                        upload_date: new Date(),

                        // ✅ Metadata con información adicional
                        metadata: {
                            size: fileInfo.size || 0,
                            bucket: BUCKET_NAME,
                            originalPath: fileInfo.path,
                            uploadSession: sessionId,
                            fileExtension: path.extname(fileInfo.originalname || '.pdf'),
                            processedAt: new Date(),
                            s3Location: `s3://${BUCKET_NAME}/${s3Key}`,
                            fechaVigenciaOriginal: fechaVigencia // Guardar la fecha original para debugging
                        }
                    });

                    documentosCreados.push(documento);
                    logger.info(`Documento ${categoria} subido exitosamente a S3 para vehículo ${vehiculoId}`);
                } catch (parseError) {
                    logger.error(`Error al parsear datos de Redis: ${parseError.message}`);
                    continue;
                }
            } catch (error) {
                logger.error(`Error al procesar documento para subida final: ${error.message}`);
                // Continuar con el siguiente documento
            }
        }

        // Limpiar directorio temporal después de procesar todos los documentos
        await fs.rm(tempDir, { recursive: true, force: true });
        logger.info(`Directorio temporal eliminado: ${tempDir}`);

        return documentosCreados;
    } catch (error) {
        logger.error(`Error al subir documentos procesados: ${error.message}`);
        // Intentar eliminar directorio temporal incluso si hay error
        try {
            // await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
            logger.error(`Error al limpiar directorio temporal: ${cleanupError.message}`);
        }
        throw error;
    }
}

/**
 * Sube documentos finales a S3 después de procesar un conductor exitosamente
 * Esta función puede usarse tanto para creación como para actualización de documentos
 * @param {string} sessionId - ID de la sesión
 * @param {string} conductorId - ID del conductor
 * @param {Object} fechasVigencia - Objeto con las fechas de vigencia por categoría (OPCIONAL)
 * @param {boolean} isUpdate - Indica si es una actualización (true) o creación (false)
 * @param {Array} categorias - Array de categorías a actualizar (solo para updates)
 * @returns {Promise<Array>} - Array de documentos creados
 */
async function uploadProcessedDocumentsConductor(sessionId, conductorId, fechasVigencia, isUpdate = false, categorias = []) {
    const documentosCreados = [];
    const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);

    try {
        // ✅ VALIDACIÓN OPCIONAL: fechasVigencia puede estar presente o ser null
        if (fechasVigencia && typeof fechasVigencia !== 'object') {
            throw new Error('fechasVigencia debe ser un objeto válido si se proporciona');
        }

        logger.info(`Iniciando subida de documentos de conductor ${conductorId} con fechas de vigencia: ${JSON.stringify(fechasVigencia)}`);

        // Verificar que el directorio existe
        const exists = await fs.access(tempDir).then(() => true).catch(() => false);
        if (!exists) {
            logger.warn(`Directorio temporal no encontrado: ${tempDir}`);
            return documentosCreados;
        }

        // Si es una actualización, eliminar SOLO los documentos de las categorías que se están actualizando
        if (isUpdate && categorias && categorias.length > 0) {
            try {
                logger.info(`Eliminando documentos antiguos para conductor ${conductorId} en categorías: ${categorias.join(', ')}`);

                // Buscar solo documentos de las categorías específicas
                const documentosAntiguos = await Documento.findAll({
                    where: {
                        conductor_id: conductorId, // ✅ CAMBIADO: conductor_id en lugar de vehiculo_id
                        categoria: categorias
                    }
                });

                logger.info(`Encontrados ${documentosAntiguos.length} documentos antiguos para eliminar`);

                // Eliminar archivos de S3
                for (const doc of documentosAntiguos) {
                    try {
                        if (doc.s3_key) {
                            const deleteCommand = {
                                Bucket: BUCKET_NAME,
                                Key: doc.s3_key
                            };

                            await s3Client.send(new DeleteObjectCommand(deleteCommand));
                            logger.info(`Documento eliminado de S3: ${doc.s3_key} (categoría: ${doc.categoria})`);
                        }
                    } catch (s3Error) {
                        logger.warn(`Error al eliminar documento de S3 (${doc.s3_key}): ${s3Error.message}`);
                    }
                }

                // Eliminar registros de la base de datos
                if (documentosAntiguos.length > 0) {
                    await Documento.destroy({
                        where: {
                            conductor_id: conductorId,
                            categoria: categorias
                        }
                    });
                    logger.info(`Se eliminaron ${documentosAntiguos.length} documentos antiguos de categorías ${categorias.join(', ')} para conductor ${conductorId}`);
                }
            } catch (deleteError) {
                logger.error(`Error al eliminar documentos antiguos: ${deleteError.message}`);
            }
        }

        // Obtener información de documentos desde Redis
        const fileInfoKeys = await redisClient.keys(`conductor:${sessionId}:files:*`); // ✅ CAMBIADO: conductor en lugar de vehiculo

        for (const key of fileInfoKeys) {
            try {
                // Extraer categoría del documento de la clave de Redis
                const categoria = key.split(':').pop();
                const fileInfoStr = await redisClient.get(key);
                logger.info(`Datos de Redis para ${key}: ${fileInfoStr}`);

                if (!fileInfoStr) {
                    logger.warn(`No se encontraron datos en Redis para la clave ${key}`);
                    continue;
                }

                try {
                    const fileInfo = JSON.parse(fileInfoStr);
                    logger.info(`Información del archivo parseada: ${JSON.stringify(fileInfo)}`);

                    // Verificar que la información del archivo es completa
                    if (!fileInfo.path) {
                        logger.warn(`No se encontró ruta para documento ${categoria}`);
                        continue;
                    }

                    // Verificar que el archivo existe en el sistema
                    const fileExists = await fs.access(fileInfo.path).then(() => true).catch(() => false);
                    if (!fileExists) {
                        logger.warn(`El archivo ${fileInfo.path} no existe en el sistema`);
                        continue;
                    }

                    // Leer el archivo
                    const fileContent = await fs.readFile(fileInfo.path);
                    logger.info(`Archivo leído: ${fileInfo.path}, tamaño: ${fileContent.length} bytes`);

                    // Verificar que el archivo no esté vacío
                    if (fileContent.length === 0) {
                        logger.warn(`¡ALERTA! Archivo con 0 bytes: ${fileInfo.path}`);
                        continue;
                    }

                    // Generar ID único para el documento
                    const documentId = uuidv4();

                    // ✅ CAMBIADO: Ruta S3 específica para conductores
                    const s3Key = `conductores/${conductorId}/documentos/${categoria}/${documentId}${path.extname(fileInfo.originalname || 'documento.pdf')}`;

                    // Subir a S3
                    try {
                        logger.info(`Iniciando subida a S3: ${s3Key}, tamaño: ${fileContent.length} bytes`);

                        const upload = new Upload({
                            client: s3Client,
                            params: {
                                Bucket: BUCKET_NAME,
                                Key: s3Key,
                                Body: fileContent,
                                ContentType: fileInfo.mimetype || 'application/octet-stream',
                                Metadata: {
                                    'original-filename': fileInfo.originalname || `${categoria}.pdf`,
                                    'document-category': categoria,
                                    'conductor-id': conductorId, // ✅ CAMBIADO: conductor-id
                                    'file-size': String(fileContent.length)
                                }
                            }
                        });

                        const result = await upload.done();
                        logger.info(`Subida exitosa a S3: ${s3Key}, ETag: ${result.ETag}`);
                    } catch (s3Error) {
                        logger.error(`Error al subir a S3: ${s3Error.message}`);
                        if (s3Error.message.includes('credentials')) {
                            logger.error('Posible problema con las credenciales de AWS');
                        }
                        throw s3Error;
                    }

                    // ✅ OPCIONAL: Buscar fecha de vigencia si está disponible
                    let fechaVigencia = null;

                    if (fechasVigencia) {
                        // Buscar coincidencia exacta primero
                        if (fechasVigencia[categoria]) {
                            fechaVigencia = fechasVigencia[categoria];
                        } else {
                            // ✅ MAPEO específico para documentos de CONDUCTOR
                            const categoriaMapping = {
                                'CEDULA': ['CEDULA_CIUDADANIA', 'CC', 'IDENTIFICACION'],
                                'LICENCIA_CONDUCCION': ['LICENCIA', 'LICENSE', 'PASE'],
                                'CERTIFICADO_MEDICO': ['MEDICO', 'CERTIFICADO_SALUD', 'EXAMEN_MEDICO'],
                                'ANTECEDENTES_PENALES': ['ANTECEDENTES', 'JUDICIAL', 'PENALES'],
                                'CARTA_RECOMENDACION': ['RECOMENDACION', 'REFERENCIA', 'CARTA'],
                                'CERTIFICADO_EXPERIENCIA': ['EXPERIENCIA', 'LABORAL', 'TRABAJO'],
                                'FOTO': ['FOTOGRAFIA', 'IMAGEN', 'RETRATO']
                            };

                            // Buscar en el mapping
                            for (const [key, aliases] of Object.entries(categoriaMapping)) {
                                if (aliases.includes(categoria) && fechasVigencia[key]) {
                                    fechaVigencia = fechasVigencia[key];
                                    break;
                                }
                            }

                            // Búsqueda flexible si no encuentra coincidencia exacta
                            if (!fechaVigencia) {
                                const fechaKey = Object.keys(fechasVigencia).find(key =>
                                    key.toLowerCase().includes(categoria.toLowerCase()) ||
                                    categoria.toLowerCase().includes(key.toLowerCase())
                                );
                                if (fechaKey) {
                                    fechaVigencia = fechasVigencia[fechaKey];
                                }
                            }
                        }
                    }

                    // ✅ OPCIONAL: Solo asignar fecha si existe
                    if (!fechaVigencia) {
                        logger.info(`No se encontró fecha de vigencia para categoría ${categoria} en conductor ${conductorId}. Se guardará sin fecha de vigencia.`);
                    }

                    // Crear registro en la base de datos
                    const documento = await Documento.create({
                        id: documentId,
                        conductor_id: conductorId, // ✅ CAMBIADO: conductor_id en lugar de vehiculo_id

                        // ✅ Campos obligatorios del modelo
                        categoria: categoria,
                        nombre_original: fileInfo.originalname || `${categoria}.pdf`,
                        nombre_archivo: `${documentId}${path.extname(fileInfo.originalname || '.pdf')}`,
                        ruta_archivo: s3Key,
                        size: fileInfo.size || fileContent.length,
                        estado: 'vigente',
                        mimetype: fileInfo.mimetype || 'application/octet-stream',

                        // ✅ Campos específicos
                        s3_key: s3Key,
                        filename: fileInfo.originalname || `${categoria}.pdf`,
                        fecha_vigencia: fechaVigencia ? new Date(fechaVigencia) : null, // ✅ OPCIONAL: Puede ser null
                        upload_date: new Date(),

                        // ✅ Metadata con información adicional
                        metadata: {
                            size: fileInfo.size || fileContent.length,
                            bucket: BUCKET_NAME,
                            originalPath: fileInfo.path,
                            uploadSession: sessionId,
                            fileExtension: path.extname(fileInfo.originalname || '.pdf'),
                            processedAt: new Date(),
                            s3Location: `s3://${BUCKET_NAME}/${s3Key}`,
                            fechaVigenciaOriginal: fechaVigencia,
                            documentType: 'conductor' // ✅ Identificador del tipo de documento
                        }
                    });

                    documentosCreados.push(documento);
                    logger.info(`Documento ${categoria} subido exitosamente a S3 para conductor ${conductorId}${fechaVigencia ? ` con vigencia hasta ${fechaVigencia}` : ' sin fecha de vigencia'}`);
                } catch (parseError) {
                    logger.error(`Error al parsear datos de Redis: ${parseError.message}`);
                    continue;
                }
            } catch (error) {
                logger.error(`Error al procesar documento para subida final: ${error.message}`);
                continue;
            }
        }

        // Limpiar directorio temporal después de procesar todos los documentos
        await fs.rm(tempDir, { recursive: true, force: true });
        logger.info(`Directorio temporal eliminado: ${tempDir}`);

        // ✅ VALIDACIÓN FINAL: Verificar que se crearon documentos
        if (documentosCreados.length === 0) {
            logger.warn(`No se crearon documentos para conductor ${conductorId}. Verificar datos en Redis y fechas de vigencia.`);
        } else {
            logger.info(`Se crearon ${documentosCreados.length} documentos exitosamente para conductor ${conductorId}`);
        }

        return documentosCreados;
    } catch (error) {
        logger.error(`Error al subir documentos procesados para conductor: ${error.message}`);
        // Intentar eliminar directorio temporal incluso si hay error
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
            logger.error(`Error al limpiar directorio temporal: ${cleanupError.message}`);
        }
        throw error;
    }
}
/**
 * Obtiene los documentos asociados a un vehículo por su ID
 * @param {string} vehiculoId - ID del vehículo
 * @returns {Promise<Array>} - Array de documentos
 */
async function getDocumentosByVehiculoId(vehiculoId) {
    try {
        const documentos = await Documento.findAll({
            where: { vehiculo_id: vehiculoId },
            order: [['upload_date', 'DESC']]
        });

        logger.info(`Documentos obtenidos para vehículo ${vehiculoId}: ${documentos.length}`);
        return documentos;
    } catch (error) {
        logger.error(`Error al obtener documentos para vehículo ${vehiculoId}: ${error.message}`);
        throw error;
    }
}

/**
 * Obtiene los documentos asociados a un conductor por su ID
 * @param {string} conductorId - ID del conductor
 * @returns {Promise<Array>} - Array de documentos
 */
async function getDocumentosByConductorId(conductorId) {
    try {
        const documentos = await Documento.findAll({
            where: { conductor_id: conductorId },
            order: [['upload_date', 'DESC']]
        });

        logger.info(`Documentos obtenidos para conductor ${conductorId}: ${documentos.length}`);
        return documentos;
    } catch (error) {
        logger.error(`Error al obtener documentos para conductor ${conductorId}: ${error.message}`);
        throw error;
    }
}

/**
 * Genera una URL firmada para acceso temporal a un archivo en S3
 * @param {string} s3Key - Clave del archivo en S3
 * @param {number} expiresIn - Tiempo de expiración en segundos (por defecto 15 minutos)
 * @returns {Promise<string>} - URL firmada
 */
async function generateSignedUrl(s3Key, expiresIn = 900) {
    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
        });

        // Generar URL firmada
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
        logger.info(`URL firmada generada para ${s3Key}, expira en ${expiresIn} segundos`);

        return signedUrl;
    } catch (error) {
        logger.error(`Error al generar URL firmada para ${s3Key}: ${error.message}`);
        throw error;
    }
}

/**
 * Obtiene un documento por su ID
 * @param {string} documentoId - ID del documento
 * @returns {Promise<Object>} - Documento encontrado
 */
async function getDocumentoById(documentoId) {
    try {
        const documento = await Documento.findByPk(documentoId);
        if (!documento) {
            throw new Error(`Documento con ID ${documentoId} no encontrado`);
        }
        return documento;
    } catch (error) {
        logger.error(`Error al obtener documento ${documentoId}: ${error.message}`);
        throw error;
    }
}

/**
 * Descarga directa del archivo desde S3 y lo sirve al cliente
 * @param {string} s3Key - Clave del archivo en S3
 * @param {string} filename - Nombre del archivo
 * @param {Object} res - Objeto response de Express
 */
async function downloadFileFromS3(s3Key, filename, res) {
    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
        });

        const response = await s3Client.send(command);

        // Configurar headers para descarga
        res.setHeader('Content-Type', response.ContentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', response.ContentLength);
        res.setHeader('Cache-Control', 'no-cache');

        // Stream del archivo
        response.Body.pipe(res);

        logger.info(`Archivo ${filename} descargado exitosamente desde ${s3Key}`);

    } catch (error) {
        logger.error(`Error al descargar archivo ${s3Key}: ${error.message}`);
        throw error;
    }
}

// Agregar estas funciones a tu documentService.js o crear un nuevo planillaService.js

/**
 * Sube un archivo de planilla a S3 y retorna la información del archivo
 * @param {Object} file - Archivo de multer (req.file)
 * @param {string} recargoId - ID del recargo
 * @param {string} oldS3Key - Clave S3 del archivo anterior (opcional, para eliminarlo)
 * @returns {Promise<Object>} - Información del archivo subido
 */
async function uploadPlanillaToS3(file, recargoId, oldS3Key = null) {
    try {
        // Generar ID único para el archivo
        const fileId = uuidv4();

        // Generar ruta en S3 específica para planillas
        const s3Key = `planillas/recargos/${recargoId}/${fileId}${path.extname(file.originalname)}`;

        // Leer el archivo
        const fileContent = await fs.readFile(file.path);

        if (fileContent.length === 0) {
            throw new Error('El archivo está vacío');
        }

        // Eliminar archivo anterior de S3 si existe
        if (oldS3Key && oldS3Key.trim() !== '') {
            try {
                await s3Client.send(new DeleteObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: oldS3Key
                }));
                logger.info(`Archivo anterior eliminado de S3: ${oldS3Key}`);
            } catch (deleteError) {
                logger.warn(`Error al eliminar archivo anterior de S3: ${deleteError.message}`);
                // Continuar aunque no se pueda eliminar el anterior
            }
        } else {
            logger.info('No hay archivo anterior para eliminar');
        }

        // Subir nuevo archivo a S3
        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Body: fileContent,
                ContentType: file.mimetype,
                Metadata: {
                    'original-filename': file.originalname,
                    'recargo-id': recargoId,
                    'file-size': String(file.size),
                    'upload-date': new Date().toISOString()
                }
            }
        });

        const result = await upload.done();
        logger.info(`Planilla subida exitosamente a S3: ${s3Key}, ETag: ${result.ETag}`);

        // Eliminar archivo temporal local
        try {
            await fs.unlink(file.path);
        } catch (unlinkError) {
            logger.warn(`Error al eliminar archivo temporal: ${unlinkError.message}`);
        }

        // Retornar información del archivo para guardar en BD
        return {
            archivo_planilla_url: s3Key, // Guardar la S3 key, no la URL local
            archivo_planilla_nombre: file.originalname,
            archivo_planilla_tipo: file.mimetype,
            archivo_planilla_tamaño: file.size,
            s3_key: s3Key, // Campo adicional para referenciar en S3
            s3_bucket: BUCKET_NAME
        };

    } catch (error) {
        logger.error(`Error al subir planilla a S3: ${error.message}`);

        // Limpiar archivo temporal si existe
        try {
            if (file && file.path) {
                await fs.unlink(file.path);
            }
        } catch (unlinkError) {
            logger.warn(`Error al limpiar archivo temporal: ${unlinkError.message}`);
        }

        throw error;
    }
}

/**
 * Elimina un archivo de planilla de S3
 * @param {string} s3Key - Clave del archivo en S3
 * @returns {Promise<boolean>} - True si se eliminó exitosamente
 */
async function deletePlanillaFromS3(s3Key) {
    try {
        if (!s3Key) {
            logger.warn('No se proporcionó S3 key para eliminar');
            return false;
        }

        await s3Client.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key
        }));

        logger.info(`Planilla eliminada de S3: ${s3Key}`);
        return true;

    } catch (error) {
        logger.error(`Error al eliminar planilla de S3: ${error.message}`);
        return false;
    }
}

module.exports = {
    saveTemporaryDocument,
    uploadProcessedDocumentsVehiculo,
    uploadProcessedDocumentsConductor,
    getDocumentosByVehiculoId,
    getDocumentosByConductorId,
    generateSignedUrl,
    downloadFileFromS3,
    getDocumentoById,
    uploadPlanillaToS3,
    deletePlanillaFromS3,
};