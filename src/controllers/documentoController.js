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
 * @param {boolean} isUpdate - Indica si es una actualización (true) o creación (false)
 * @returns {Promise<Array>} - Array de documentos creados
 */
async function uploadProcessedDocuments(sessionId, vehiculoId, isUpdate = false) {
    const documentosCreados = [];
    const tempDir = path.join(__dirname, '..', '..', 'temp', sessionId);

    try {
        // Verificar que el directorio existe
        const exists = await fs.access(tempDir).then(() => true).catch(() => false);
        if (!exists) {
            logger.warn(`Directorio temporal no encontrado: ${tempDir}`);
            return documentosCreados;
        }

        // Si es una actualización, eliminar documentos antiguos de S3 y base de datos
        if (isUpdate) {
            try {
                logger.info(`Eliminando documentos antiguos para vehículo ${vehiculoId}`);
                const documentosAntiguos = await Documento.findAll({
                    where: { vehiculo_id: vehiculoId }
                });

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
                            logger.info(`Documento eliminado de S3: ${doc.s3_key}`);
                        }
                    } catch (s3Error) {
                        logger.warn(`Error al eliminar documento de S3 (${doc.s3_key}): ${s3Error.message}`);
                        // Continuar con el siguiente aunque haya errores
                    }
                }

                // Eliminar registros de la base de datos
                if (documentosAntiguos.length > 0) {
                    await Documento.destroy({
                        where: { vehiculo_id: vehiculoId }
                    });
                    logger.info(`Se eliminaron ${documentosAntiguos.length} documentos antiguos de la base de datos para vehículo ${vehiculoId}`);
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

                    // Crear registro en la base de datos
                    const documento = await Documento.create({
                        id: documentId,
                        vehiculo_id: vehiculoId,
                        document_type: categoria,       // Nombre correcto según el modelo
                        s3_key: s3Key,                  // Nombre correcto según el modelo
                        filename: fileInfo.originalname || `${categoria}.pdf`,
                        mimetype: fileInfo.mimetype || 'application/octet-stream',
                        upload_date: new Date(),        // Nombre correcto según el modelo
                        metadata: {
                            size: fileInfo.size || 0,
                            bucket: BUCKET_NAME
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

module.exports = {
    saveTemporaryDocument,
    uploadProcessedDocuments,
    getDocumentosByVehiculoId,
    generateSignedUrl,
    getDocumentoById
};