import json
import re
import unicodedata
import sys
import os
import argparse
import traceback
from datetime import datetime

# Función para normalizar texto
def normalize_text(text):
    return unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8').upper()

def parse_fecha(fecha_str):
    """Intenta convertir la fecha desde distintos formatos conocidos"""
    for fmt in ('%d-%m-%Y', '%d/%m/%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(fecha_str.strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Formato de fecha no reconocido: {fecha_str}")

class LICENCIAProcessor:
    def __init__(self, ocr_data, numero_identificacion=None, fecha_nacimiento=None):
        self.data = ocr_data
        self.content = ocr_data.get('analyzeResult', {}).get('content', '')
        self.lines = self.content.split('\n')
        self.numero_identificacion = numero_identificacion
        self.fecha_nacimiento = fecha_nacimiento
        self.result = {
            "validation": None,
        }
    
    def find_line_index(self, keyword, normalize=True):
        """Encontrar el índice de la línea que contiene una palabra clave"""
        keyword_norm = normalize_text(keyword) if normalize else keyword
        for i, line in enumerate(self.lines):
            line_norm = normalize_text(line) if normalize else line
            if keyword_norm in line_norm:
                return i
        return -1
    
    def is_valid_licencia(self):
        """Verificar si el documento es una cédula de ciudadanía válida"""
        # Buscar términos clave de la cédula en el contenido normalizado
        keywords = [
            "REPUBLICA DE COLOMBIA MINISTERIO DE TRANSPORTE LICENCIA DE CONDUCCION",
            "CEDULA DE CIUDADANIA",
            "IDENTIFICACION PERSONAL"
        ]
        normalized_content = normalize_text(self.content)
        for keyword in keywords:
            if keyword in normalized_content:
                return True
        return False
    
        # OPCIÓN 1: Método de instancia (recomendado)
    def normalize_numero_identificacion(self, numero):
        """Normalizar número de identificación quitando puntos y espacios"""
        if not numero:
            return ""
        return re.sub(r'[.\s]', '', str(numero))
    
    def is_same_conductor(self):
        """Verificar si el número de identificación coincide con el conductor actual"""
        if not self.numero_identificacion:
            return False
        normalized_numero = self.normalize_numero_identificacion(self.numero_identificacion)
        for line in self.lines:
            # Normalizar la línea actual
            if normalized_numero in self.normalize_numero_identificacion(line):
                return True 
            

    def extract_categorys(self):
        """Extraer las categorías válidas de la licencia de conducción y calcular vigencia"""
        categorias_validas = ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3']
        categorias_con_vigencia = []
        fecha_expedicion_licencia = "17/11/2023"  # Cambiado a formato DD/MM/YYYY
        
        # Calcular edad
        if not self.fecha_nacimiento or not fecha_expedicion_licencia:
            self.result['licencia'] = []
            return
        
        # Convertir strings a objetos date
        try:
            if isinstance(self.fecha_nacimiento, str):
                fecha_nacimiento_date = parse_fecha(self.fecha_nacimiento)
            else:
                fecha_nacimiento_date = self.fecha_nacimiento

            if isinstance(fecha_expedicion_licencia, str):
                fecha_expedicion_date = parse_fecha(fecha_expedicion_licencia)
            else:
                fecha_expedicion_date = fecha_expedicion_licencia
        except ValueError as e:
            print(f"Error al convertir fechas: {e}")
            self.result['licencia'] = []
            return
        
        hoy = datetime.now().date()
        edad = hoy.year - fecha_nacimiento_date.year - (
            (hoy.month, hoy.day) < (fecha_nacimiento_date.month, fecha_nacimiento_date.day)
        )
        
        for line in self.lines:
            text = normalize_text(line).replace(' ', '')  # Normalizar y quitar espacios
            for cat in categorias_validas:
                if cat in text and not any(d['categoria'] == cat for d in categorias_con_vigencia):
                    # Determinar vigencia según categoría y edad
                    if cat.startswith('C'):  # Servicio público
                        años_vigencia = 3
                    else:  # Servicio particular
                        if edad < 60:
                            años_vigencia = 10
                        elif 60 <= edad < 80:
                            años_vigencia = 5
                        else:
                            años_vigencia = 1
                    
                    # Calcular próxima fecha de renovación
                    fecha_renovacion = fecha_expedicion_date.replace(
                        year=fecha_expedicion_date.year + años_vigencia
                    )
                    
                    categorias_con_vigencia.append({
                        'categoria': cat,
                        'vigencia_hasta': fecha_renovacion.strftime('%d/%m/%Y')  # Formato DD/MM/YYYY para salida
                    })
        
        self.result['licencia'] = categorias_con_vigencia
    
    def extraer_fecha_expedicion(self):
        fecha_nacimiento = parse_fecha(self.fecha_nacimiento)
        hoy = datetime.now().date()

        if not fecha_nacimiento:
            raise ValueError("Fecha de nacimiento inválida")

        for line in self.lines:
            if 'FECHA DE EXPEDICION' in line.upper():
                
                # Buscar fecha con regex
                coincidencia = re.search(r'\d{2}[-/]\d{2}[-/]\d{4}', line)
                if coincidencia:
                    posible_fecha = coincidencia.group()
                    fecha_expedicion = parse_fecha(posible_fecha)
                    if not fecha_expedicion:
                        continue
                    if fecha_nacimiento <= fecha_expedicion <= hoy:
                        return fecha_expedicion
                    else:
                        print(f"⚠️ Fecha de expedición fuera de rango lógico: {fecha_expedicion}")
        return None

    def process(self):
        """Procesar todos los campos y devolver el resultado"""
        if not self.is_valid_licencia():
            return {"error": "No es una CEDULA válida"}
        
        self.result['validation'] = self.is_same_conductor()
        self.result["fecha_expedicion_licencia"] = self.extraer_fecha_expedicion().strftime("%d/%m/%Y")

        self.extract_categorys()
        
        return self.result

# Función principal para procesar el OCR
def process_licencia_data(data, numero_identificacion=None, fecha_nacimiento=None):
    try:
        processor = LICENCIAProcessor(data, numero_identificacion, fecha_nacimiento)
        result = processor.process()
        return result
    except Exception as e:
        import traceback
        return {"error": str(e), "trace": traceback.format_exc()}

# Ejecución principal
if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser(description='Procesar datos OCR')
        parser.add_argument('--file', type=str, help='Ruta al archivo JSON con datos OCR')
        parser.add_argument('--numero_identificacion', type=str, help='Identificación del conductor (opcional)')
        parser.add_argument('--fecha_nacimiento', type=str, help='Fecha de nacimiento del conductor (opcional)')
        
        args = parser.parse_args()

        # Determinar qué archivo procesar
        file_path = None
        
        if args.file:
            # Usar el archivo especificado por argumento
            file_path = args.file
            if not os.path.exists(file_path):
                print(f"ERROR: El archivo {file_path} no existe", file=sys.stderr)
                print(json.dumps({"error": f"Archivo no encontrado: {file_path}"}))
                sys.exit(1)
        elif len(sys.argv) > 1 and not sys.argv[1].startswith('--'):
            # Si el primer argumento no es una opción, intentar interpretarlo como JSON
            try:
                data = json.loads(sys.argv[1])
                # Si llegamos aquí, el JSON se parseó correctamente, no necesitamos archivo
                file_path = None
            except json.JSONDecodeError:
                print("ERROR: El primer argumento no es JSON válido", file=sys.stderr)
                print(json.dumps({"error": "Argumento no es JSON válido"}))
                sys.exit(1)
        else:
            # Usar archivo por defecto
            file_path = 'temp/tempOcrData_CEDULA.json'
            if not os.path.exists(file_path):
                print(f"ERROR: El archivo por defecto {file_path} no existe", file=sys.stderr)
                print(json.dumps({"error": f"Archivo por defecto no encontrado: {file_path}"}))
                sys.exit(1)
        
        # Leer datos si es necesario
        if file_path:
            try:
                with open(file_path, 'r', encoding='utf-8') as file:
                    data = json.load(file)
            except json.JSONDecodeError as e:
                print(f"ERROR: El archivo no contiene JSON válido: {str(e)}", file=sys.stderr)
                print(json.dumps({"error": f"JSON inválido en archivo: {str(e)}"}))
                sys.exit(1)
        
        # Procesar los datos
        result = process_licencia_data(data, args.numero_identificacion, args.fecha_nacimiento)
        
        # Imprimir resultado como JSON (único output a stdout)
        print(json.dumps(result, indent=4, ensure_ascii=False))
        
    except Exception as e:
        # Errores a stderr para depuración
        print(f"ERROR inesperado: {str(e)}", file=sys.stderr)
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        
        # Error en formato JSON a stdout para que el proceso JS pueda capturarlo
        print(json.dumps({"error": str(e)}))
        sys.exit(1)