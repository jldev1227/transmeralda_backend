const nodemailer = require("nodemailer");
const fs = require('fs');
const path = require('path');

// Función para enviar correo con el código de verificación
exports.enviarCorreoVerificacion = async (destinatario, codigo, nombreUsuario) => {
  try {
    // Configuración del transportador de correo
    const transporterConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    };

    const transporter = nodemailer.createTransport(transporterConfig);
    const logoPath = path.join(__dirname, '../../public/assets/logo.svg');
    const logoBase64 = fs.readFileSync(logoPath, { encoding: 'base64' });
    
    // Crear el diseño del código en casillas individuales para el HTML
    const digitosHTML = codigo.split('').map(digito => 
      `<td style="width: 40px; height: 40px; background-color: #f6f8fa; border-radius: 6px; font-size: 20px; font-weight: bold; text-align: center; padding: 8px; margin: 0 4px;">${digito}</td>`
    ).join('\n');

    // Plantilla HTML del correo
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Código de verificación</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
          line-height: 1.6;
          color: #24292e;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .logo {
          max-height: 50px;
          margin-bottom: 20px;
        }
        .content {
          background-color: #ffffff;
          border: 1px solid #e1e4e8;
          border-radius: 6px;
          padding: 30px;
          margin-bottom: 30px;
        }
        .code-container {
          margin: 30px 0;
          text-align: center;
        }
        .code-table {
          margin: 0 auto;
          border-spacing: 8px;
        }
        .footer {
          font-size: 12px;
          color: #6a737d;
          text-align: center;
        }
        .button {
          display: inline-block;
          padding: 10px 16px;
          font-size: 14px;
          font-weight: 500;
          line-height: 20px;
          color: #ffffff;
          background-color: #2ea44f;
          border-radius: 6px;
          text-decoration: none;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="content">
          <h2>Código de verificación</h2>
          <p>Hola ${nombreUsuario},</p>
          <p>Has solicitado restablecer tu contraseña. Utiliza el siguiente código para verificar tu identidad:</p>
          
          <div class="code-container">
            <table class="code-table">
              <tr>
                ${digitosHTML}
              </tr>
            </table>
          </div>
          
          <p>Este código expirará en 15 minutos.</p>
          <p>Si no solicitaste este cambio, puedes ignorar este correo. Tu cuenta sigue segura.</p>
        </div>
        <div class="footer">
          <p>Este es un correo electrónico automático, por favor no respondas a este mensaje.</p>
          <p>&copy; ${new Date().getFullYear()} Sistema de Gestión de Transmeralda. Todos los derechos reservados.</p>
        </div>
      </div>
    </body>
    </html>
    `;

    // Configuración del correo
    const mailOptions = {
      from: `"Sistema de Nómina" <${process.env.SMTP_USER}>`,
      to: destinatario,
      subject: "Código de verificación para cambio de contraseña",
      html: htmlContent,
      // Versión de texto plano para clientes que no soportan HTML
      text: `Código de verificación: ${codigo}\n\nEste código expirará en 15 minutos.\n\nSi no solicitaste este cambio, puedes ignorar este correo. Tu cuenta sigue segura.`,
    };

    // Enviar el correo
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error al enviar correo:", error);
    throw error;
  }
};
