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

class CONTRATOProcessor:
    def __init__(self, ocr_data, numero_identificacion=None):
        self.data = ocr_data
        self.content = ocr_data.get('analyzeResult', {}).get('content', '')
        self.lines = self.content.split('\n')
        self.numero_identificacion = numero_identificacion
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
    
    def is_valid_contrato(self):
        """Verificar si el documento es un contrato válido"""
        normalized_content = normalize_text(self.content)
        
        # CONDUCTOR es obligatorio - debe estar presente
        if "CONDUCTOR" not in normalized_content:
            return False
        
        # Al menos uno de estos keywords adicionales debe estar presente
        required_keywords = [
            "CONTRATO",
            "DATOS DEL EMPLEADOR", 
            "DATOS DEL TRABAJADOR"
        ]
        
        # Verificar que al menos uno de los keywords requeridos esté presente
        has_required_keyword = any(keyword in normalized_content for keyword in required_keywords)
        
        if not has_required_keyword:
            return False
        
        return True
    
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
            
    def _is_valid_email(self, email):
        # Dominios comunes válidos para filtrar falsos positivos
        common_domains = [
            'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
            'yahoo.es', 'hotmail.es', 'live.com', 'icloud.com',
            'protonmail.com', 'aol.com', 'mail.com', 'zoho.com',
            # Dominios colombianos comunes
            'une.net.co', 'telecom.com.co', 'etb.net.co', 'tigo.com.co',
            'claro.com.co', 'movistar.com.co'
        ]
        
        local, domain = email.split('@')
        
        # Verificar caracteres válidos en la parte local
        valid_local_chars = re.match(r'^[A-Za-z0-9._%+-]+$', local)
        if not valid_local_chars:
            return False
        
        # Verificar que no empiece o termine con punto
        if local.startswith('.') or local.endswith('.'):
            return False
        
        # Verificar que no tenga puntos consecutivos
        if '..' in local:
            return False
        
        # Verificar dominio
        if not re.match(r'^[A-Za-z0-9.-]+$', domain):
            return False
        
        # Bonus: dar prioridad a dominios conocidos
        if domain.lower() in [d.lower() for d in common_domains]:
            return True
        
        # Verificar estructura básica del dominio
        domain_parts = domain.split('.')
        if len(domain_parts) < 2:
            return False
        
        # Verificar que cada parte del dominio sea válida
        for part in domain_parts:
            if not part or not re.match(r'^[A-Za-z0-9-]+$', part):
                return False
            if part.startswith('-') or part.endswith('-'):
                return False
        
        return True
            
            
    def extract_email(self):
        """Extraer el email del documento usando patrones de validación"""
        # Patrón básico para emails
        email_pattern = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b')
        
        for line in self.lines:
            # Normalizar la línea removiendo espacios extra
            normalized_line = re.sub(r'\s+', ' ', line.strip())
            
            match = email_pattern.search(normalized_line)
            if match:
                email = match.group(0).lower()  # Convertir a minúsculas
                # Validación adicional básica
                if self._is_valid_email(email):
                    self.result['email'] = email
                    return email
        
        # Si no se encuentra email
        self.result['email'] = None
        return None
            
    # Versión alternativa más robusta
    def extract_number_phone(self):
        """Extraer el número de teléfono del documento - versión avanzada"""
        # Patrones comunes para teléfonos colombianos
        phone_patterns = [
            re.compile(r'\b3\d{9}\b'),           # 3XXXXXXXXX (10 dígitos)
            re.compile(r'\b\+57\s*3\d{9}\b'),   # +57 3XXXXXXXXX
            re.compile(r'\b57\s*3\d{9}\b'),     # 57 3XXXXXXXXX
            re.compile(r'\b3\d{2}[-\s]\d{3}[-\s]\d{4}\b'),  # 3XX-XXX-XXXX o 3XX XXX XXXX
        ]
        
        for line in self.lines:
            # Limpiar y normalizar la línea
            clean_line = re.sub(r'[^\d\+\-\s]', ' ', line)  # Solo números, +, -, espacios
            
            for pattern in phone_patterns:
                match = pattern.search(clean_line)
                if match:
                    # Extraer solo los dígitos
                    phone_digits = re.sub(r'[^\d]', '', match.group(0))
                    
                    # Validar que sea un número colombiano válido
                    if len(phone_digits) >= 10:
                        # Si tiene código de país, tomar los últimos 10 dígitos
                        if len(phone_digits) > 10:
                            phone_digits = phone_digits[-10:]
                        
                        # Verificar que empiece con 3 (celulares colombianos)
                        if phone_digits.startswith('3'):
                            self.result['telefono'] = phone_digits
                            return phone_digits
        
        # Búsqueda más general si no se encuentra con patrones específicos
        general_pattern = re.compile(r'\b3\d{9}\b')
        for line in self.lines:
            # Remover todos los caracteres no numéricos excepto espacios
            digits_only = re.sub(r'[^\d\s]', '', line)
            # Remover espacios múltiples
            clean_digits = re.sub(r'\s+', '', digits_only)
            
            match = general_pattern.search(clean_digits)
            if match:
                self.result['telefono'] = match.group(0)
                return match.group(0)
        
        # Si no se encuentra ningún teléfono
        self.result['telefono'] = None
        return None

    def extract_employer_address(self):
        """Extraer la dirección del empleador - siempre está en la línea siguiente a 'DIRECCIÓN:'"""
        
        # Palabras clave para identificar la línea de dirección del empleador
        address_labels = [
            'dirección:',
            'direccion:',
            'dir.:',
            'dir:'
        ]
        
        for i, line in enumerate(self.lines):
            # Normalizar la línea para comparación
            normalized_line = normalize_text(line).lower().strip()
            
            # Verificar si la línea contiene la etiqueta de dirección del empleador
            if any(label in normalized_line for label in address_labels):
                # La dirección está en la siguiente línea
                if i + 1 < len(self.lines):
                    next_line = self.lines[i + 1].strip()
                    
                    # Verificar que la siguiente línea no esté vacía y contenga una dirección válida
                    if next_line and self._is_valid_address_format(next_line):
                        cleaned_address = self._clean_address_format(next_line)
                        self.result['direccion'] = cleaned_address
                        return cleaned_address
        
        # Si no se encuentra
        self.result['direccion'] = None
        return None

    def _is_valid_address_format(self, text):
        """Verificar que el texto tenga formato de dirección (letras, números, guiones, N°, #)"""
        if not text or len(text.strip()) < 3:
            return False
        
        # Patrón que acepta letras, números, espacios, guiones, N°, # y algunos caracteres especiales
        address_pattern = re.compile(r'^[A-Za-z0-9\s\-#°Nº\.]+$')
        
        # Verificar que coincida con el patrón
        if not address_pattern.match(text):
            return False
        
        # Debe contener al menos un número (característica común de direcciones)
        if not re.search(r'\d', text):
            return False
        
        # Debe contener al menos una letra (para evitar solo números)
        if not re.search(r'[A-Za-z]', text):
            return False
        
        return True

    def _is_valid_address_format(self, text):
        """Verificar que el texto tenga formato de dirección (letras, números, guiones, N°, #)"""
        if not text or len(text.strip()) < 3:
            return False
        
        # Patrón que acepta letras, números, espacios, guiones, N°, # y algunos caracteres especiales
        address_pattern = re.compile(r'^[A-Za-z0-9\s\-#°Nº\.]+$')
        
        # Verificar que coincida con el patrón
        if not address_pattern.match(text):
            return False
        
        # Debe contener al menos un número (característica común de direcciones)
        if not re.search(r'\d', text):
            return False
        
        # Debe contener al menos una letra (para evitar solo números)
        if not re.search(r'[A-Za-z]', text):
            return False
        
        return True
    
    def _clean_address_format(self, address):
        """Limpiar y formatear la dirección manteniendo la estructura original"""
        if not address:
            return None
        
        # Remover espacios extra pero mantener la estructura
        cleaned = re.sub(r'\s+', ' ', address.strip())
        
        # Convertir a mayúsculas para consistencia
        cleaned = cleaned.upper()
        
        # Normalizar algunos caracteres comunes
        cleaned = cleaned.replace('Nº', '#')
        cleaned = cleaned.replace('N°', '#')
        cleaned = cleaned.replace('°', '#')
        
        return cleaned
    
    def extract_sede(self):
        """Extraer la sede donde fue contratado el trabajador (YOPAL, VILLANUEVA, TAURAMENA)"""
        
        # Sedes válidas disponibles
        sedes_validas = ['YOPAL', 'VILLANUEVA', 'TAURAMENA']
        
        # Patrones que indican sede de contratación
        patrones_contratacion = [
            'CIUDAD DONDE HA SIDO CONTRATADO EL TRABAJADOR',
            'CIUDAD DONDE HA SIDO CONTRATADO',
            'LUGAR DE CONTRATACION',
            'LUGAR DE CONTRATACIÓN',
            'SEDE DE CONTRATACION',
            'SEDE DE CONTRATACIÓN',
            'CONTRATADO EN',
            'CIUDAD DE CONTRATO',
            'LUGAR DEL CONTRATO'
        ]
        
        # Buscar en todas las líneas
        for i, line in enumerate(self.lines):
            normalized_line = normalize_text(line).upper()
            
            # Verificar si la línea contiene algún patrón de contratación
            for patron in patrones_contratacion:
                if patron in normalized_line:
                    
                    # Buscar sede en la misma línea
                    sede_encontrada = self._extract_sede_from_line(line, sedes_validas)
                    if sede_encontrada:
                        self.result['sede_trabajo'] = sede_encontrada
                        return sede_encontrada
                    
                    # Buscar sede en las próximas 5 líneas
                    for j in range(1, 6):
                        if i + j < len(self.lines):
                            sede_encontrada = self._extract_sede_from_line(self.lines[i + j], sedes_validas)
                            if sede_encontrada:
                                self.result['sede_trabajo'] = sede_encontrada
                                return sede_encontrada
        
        # Buscar sedes en contexto general de contratación (fallback)
        for i, line in enumerate(self.lines):
            normalized_line = normalize_text(line).upper()
            
            # Verificar si la línea contiene palabras clave de contratación
            if self._contains_contratacion_keywords(normalized_line):
                for sede in sedes_validas:
                    if sede in normalized_line:
                        if self._is_valid_contratacion_context(normalized_line, sede):
                            self.result['sede_trabajo'] = sede
                            return sede
        
        # Si no se encuentra sede específica, devolver None
        print("No se encontró sede de contratación")
        self.result['sede_trabajo'] = None
        return None

    def _extract_sede_from_line(self, line, sedes_validas):
        """Extraer sede de una línea específica"""
        normalized_line = normalize_text(line).upper()
        
        for sede in sedes_validas:
            if sede in normalized_line:
                # Verificar que sea la sede y no parte de otra palabra
                if self._is_complete_sede_word(normalized_line, sede):
                    return sede
        
        return None

    def _is_complete_sede_word(self, line, sede):
        """Verificar que la sede sea una palabra completa y no parte de otra palabra"""
        import re
        
        # Crear patrón para palabra completa
        pattern = r'\b' + re.escape(sede) + r'\b'
        return bool(re.search(pattern, line))

    def _contains_contratacion_keywords(self, line):
        """Verificar si la línea contiene palabras clave de contratación"""
        
        keywords_contratacion = [
            'CONTRATADO', 'CONTRATACION', 'CONTRATACIÓN', 'CONTRATO',
            'VINCULADO', 'VINCULACION', 'VINCULACIÓN',
            'EMPLEADO', 'TRABAJO', 'LABORA', 'SEDE'
        ]
        
        for keyword in keywords_contratacion:
            if keyword in line:
                return True
        
        return False

    def _is_valid_contratacion_context(self, line, sede):
        """Verificar si la sede está en un contexto válido de contratación"""
        
        # Palabras que indican que NO es la sede de contratación
        invalid_contexts = [
            'NACIÓ EN', 'NACIDO EN', 'NATURAL DE', 'PROCEDENTE DE',
            'EXPEDIDA EN', 'CÉDULA DE', 'DOCUMENTO DE', 'DOMICILIO',
            'RESIDENCIA', 'VIVE EN', 'RESIDE EN', 'NACIMIENTO',
            'EXPEDICIÓN', 'LICENCIA EXPEDIDA', 'DOCUMENTO EXPEDIDO'
        ]
        
        # Palabras que SÍ indican sede de contratación
        valid_contexts = [
            'CONTRATADO', 'CONTRATACION', 'CONTRATACIÓN', 'CONTRATO',
            'CIUDAD DONDE', 'LUGAR DE', 'SEDE DE', 'TRABAJADOR',
            'VINCULADO', 'EMPLEADO', 'LABORA'
        ]
        
        line_upper = line.upper()
        
        # Si contiene contextos inválidos, no es la sede de contratación
        for invalid in invalid_contexts:
            if invalid in line_upper:
                print(f"Contexto inválido encontrado: {invalid}")
                return False
        
        # Si contiene contextos válidos, es probable que sea la sede de contratación
        for valid in valid_contexts:
            if valid in line_upper:
                print(f"Contexto válido encontrado: {valid}")
                return True
        
        # Si no hay contexto claro, asumir que es válido
        return True
    
    def extract_fecha_ingreso(self):
        """Extraer la fecha de ingreso del conductor"""
        
        # Patrones de búsqueda para identificar la fecha de ingreso
        patrones_fecha_ingreso = [
            'FECHA DE INGRESO',
            'FECHA DE INICIO', 
            'FECHA INGRESO',
            'FECHA INICIO'
        ]
        
        # Patrones de formato de fecha más comunes
        fecha_patterns = [
            r'\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b',  # DD/MM/YYYY o DD-MM-YYYY
            r'\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b',  # YYYY/MM/DD o YYYY-MM-DD
            r'\b(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})\b',  # DD de MMMM de YYYY
            r'\b(\d{1,2})\s+(\w+)\s+(\d{4})\b',  # DD MMMM YYYY
        ]
        
        # Buscar en todas las líneas
        for i, line in enumerate(self.lines):
            normalized_line = normalize_text(line).upper()
            
            # Verificar si la línea contiene algún patrón de fecha de ingreso
            for patron in patrones_fecha_ingreso:
                if patron in normalized_line:
                    # Buscar fecha en la misma línea
                    fecha = self._extract_date_from_line(line, fecha_patterns)
                    if fecha:
                        self.result['fecha_ingreso'] = fecha
                        return fecha
                    
                    # Buscar fecha en las próximas 3 líneas
                    for j in range(1, 4):
                        if i + j < len(self.lines):
                            fecha = self._extract_date_from_line(self.lines[i + j], fecha_patterns)
                            if fecha:
                                self.result['fecha_ingreso'] = fecha
                                return fecha
        
        # Si no se encuentra fecha específica, devolver None
        self.result['fecha_ingreso'] = None
        return None

    def _extract_date_from_line(self, line, fecha_patterns):
        """Extraer fecha de una línea específica usando los patrones definidos"""
        
        meses = {
            'ENERO': '01', 'FEBRERO': '02', 'MARZO': '03', 'ABRIL': '04',
            'MAYO': '05', 'JUNIO': '06', 'JULIO': '07', 'AGOSTO': '08',
            'SEPTIEMBRE': '09', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12',
            'ENE': '01', 'FEB': '02', 'MAR': '03', 'ABR': '04',
            'MAY': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08',
            'SEP': '09', 'OCT': '10', 'NOV': '11', 'DIC': '12'
        }
        
        # Limpiar la línea de espacios extra y normalizar
        clean_line = ' '.join(line.strip().split()).upper()
        
        # Patrón específico para "DD DE MMMM DE YYYY" (como "28 DE DICIEMBRE DE 2023")
        pattern_de = r'(\d{1,2})\s+DE\s+(\w+)\s+DE\s+(\d{4})'
        match_de = re.search(pattern_de, clean_line)
        if match_de:
            try:
                day, month_name, year = match_de.groups()
                month_name = month_name.upper().strip()
                
                if month_name in meses and day.isdigit() and year.isdigit():
                    day_int = int(day)
                    if 1 <= day_int <= 31:
                        return f"{day.zfill(2)}/{meses[month_name]}/{year}"
            except (ValueError, IndexError):
                pass
        
        # Otros patrones de fecha como fallback
        for pattern in fecha_patterns:
            match = re.search(pattern, clean_line, re.IGNORECASE)
            if match:
                try:
                    groups = match.groups()
                    
                    # Patrón DD/MM/YYYY o DD-MM-YYYY
                    if len(groups) == 3 and groups[2].isdigit() and len(groups[2]) == 4:
                        if groups[0].isdigit() and groups[1].isdigit():
                            day, month, year = groups[0], groups[1], groups[2]
                            # Validar que día y mes estén en rangos válidos
                            if 1 <= int(day) <= 31 and 1 <= int(month) <= 12:
                                return f"{day.zfill(2)}/{month.zfill(2)}/{year}"
                    
                    # Patrón YYYY/MM/DD o YYYY-MM-DD
                    elif len(groups) == 3 and groups[0].isdigit() and len(groups[0]) == 4:
                        if groups[1].isdigit() and groups[2].isdigit():
                            year, month, day = groups[0], groups[1], groups[2]
                            # Validar que día y mes estén en rangos válidos
                            if 1 <= int(day) <= 31 and 1 <= int(month) <= 12:
                                return f"{day.zfill(2)}/{month.zfill(2)}/{year}"
                                
                except (ValueError, IndexError):
                    continue
        
        return None

    def _is_valid_date_context(self, line):
        """Validar que el contexto de la fecha sea apropiado para fecha de ingreso"""
        
        # Palabras que indican contexto de fecha de ingreso
        contexto_positivo = [
            'INGRESO', 'INICIO', 'CONTRATO', 'VINCULACION', 
            'EMPLEADO', 'TRABAJADOR', 'CONDUCTOR'
        ]
        
        # Palabras que indican otro tipo de fecha (para evitar falsos positivos)
        contexto_negativo = [
            'NACIMIENTO', 'EXPEDICION', 'VENCIMIENTO', 
            'EXPEDIDA', 'NACIO', 'CUMPLEANOS'
        ]
        
        normalized_line = normalize_text(line).upper()
        
        # Verificar contexto negativo primero
        for palabra in contexto_negativo:
            if palabra in normalized_line:
                return False
        
        # Verificar contexto positivo
        for palabra in contexto_positivo:
            if palabra in normalized_line:
                return True
        
        return True  # Si no hay contexto negativo, asumir que es válido
    
    def _is_valid_salary(self, salary_str):
        """Validar que el número tenga sentido como salario colombiano"""
        
        try:
            # Remover puntos y convertir a número
            salary_number = int(salary_str.replace('.', ''))
            
            print(f"      Validando salario: '{salary_str}' -> {salary_number}")
            
            # Rangos de salario válidos para Colombia (en pesos)
            min_salary = 500000      # 500 mil
            max_salary = 50000000    # 50 millones
            
            # Verificar que esté en el rango válido
            if min_salary <= salary_number <= max_salary:
                print(f"      ✓ Salario en rango válido ({min_salary:,} - {max_salary:,})")
                
                # Verificar longitud del número (al menos 6 dígitos)
                str_number = str(salary_number)
                if len(str_number) >= 6:
                    print(f"      ✓ Longitud válida: {len(str_number)} dígitos")
                    
                    # Verificar que no sea un número de documento típico
                    # Los números de cédula suelen ser más "irregulares"
                    if not self._looks_like_document_number(salary_number):
                        print(f"      ✓ No parece número de documento")
                        print(f"      ✓ SALARIO ACEPTADO: {salary_number:,}")
                        return True
                    else:
                        print(f"      ✗ Parece número de documento")
                        return False
                else:
                    print(f"      ✗ Número muy corto: {len(str_number)} dígitos")
                    return False
            else:
                print(f"      ✗ Fuera de rango: {salary_number:,} (min: {min_salary:,}, max: {max_salary:,})")
                return False
            
        except ValueError as e:
            print(f"      ✗ Error al convertir: {salary_str} - {e}")
            return False

    def _looks_like_document_number(self, number):
        """Verificar si un número parece ser un documento de identidad"""

        print(f"      Evaluando si {number} parece un documento de identidad")
        # Para 1.423.500 (1423500), claramente NO es un documento
        # Los documentos suelen ser números más irregulares
        
        str_number = str(number)
        
        # Si termina en 000 o 500, muy probablemente es salario, no documento
        if str_number.endswith('000') or str_number.endswith('500'):
            print(f"        Termina en 000/500 -> probablemente salario")
            return False
        
        # Si es múltiplo de 1000, probablemente es salario
        if number % 1000 == 0:
            print(f"        Múltiplo de 1000 -> probablemente salario")
            return False
        
        # Si tiene entre 8-11 dígitos y no cumple las condiciones anteriores,
        # podría ser documento, pero para estar seguros, aceptemos salarios en este rango
        if 8 <= len(str_number) <= 11:
            # Si está en rango típico de salarios (1M - 10M), aceptarlo como salario
            if 1000000 <= number <= 10000000:
                print(f"        En rango de salarios profesionales -> aceptar como salario")
                return False
            else:
                print(f"        Podría ser documento por longitud y rango")
                return True
        
        # Si tiene menos de 8 dígitos, no es documento común
        return False

    def _extract_salary_from_line(self, line):
        """Extraer salario de una línea específica (versión simplificada)"""
        
        # Limpiar la línea de espacios extra
        clean_line = line.strip()
        
        # Caso especial: si la línea es exactamente un número con formato de salario
        salary_exact_match = re.match(r'^\s*\$?\s*(\d{1,3}(?:\.\d{3})+)\s*$', clean_line)
        if salary_exact_match:
            number = salary_exact_match.group(1)
            if self._is_valid_salary(number):
                salary_number = int(number.replace('.', ''))
                return salary_number
        
        # Patrones más simples y directos
        salary_patterns = [
            r'(\d{1,3}(?:\.\d{3})+)',                        # Números con puntos: 1.423.500
            r'\$\s*(\d{1,3}(?:\.\d{3})+)',                   # Con peso: $ 1.423.500
            r':\s*\$?\s*(\d{1,3}(?:\.\d{3})+)',              # Después de dos puntos
            r'(\d{7,8})',                                    # Números sin puntos 7-8 dígitos
        ]
        
        for i, pattern in enumerate(salary_patterns):
            matches = re.findall(pattern, clean_line)
            if matches:
                
                for match in matches:
                    if self._is_valid_salary(match):
                        salary_number = int(match.replace('.', ''))
                        return salary_number
                    else:
                        print(f"      ✗ Salario inválido según validación")
        
        return None

    def extract_salario_base(self):
        """Extraer el salario base del conductor (versión final)"""
        
        # Patrones de búsqueda para identificar el salario
        patrones_salario = [
            'SALARIO:',
            'SALARIO BASE:',
            'SALARIO BÁSICO:',
            'SALARIO BASICO:',
            'SUELDO:',
            'SUELDO BASE:',
            'SALARIO MENSUAL:',
            'SUELDO MENSUAL:',
            'REMUNERACIÓN:',
            'REMUNERACION:',
            'DEVENGADO:',
            'INGRESO:',
            'VALOR SALARIO:',
            'BASICO:',
            'SALARIO'
        ]
        
        # Buscar en todas las líneas
        for i, line in enumerate(self.lines):
            normalized_line = normalize_text(line).upper()
            
            # Verificar si la línea contiene algún patrón de salario
            for patron in patrones_salario:
                if patron in normalized_line:
                    
                    # Buscar salario en la misma línea primero
                    salario = self._extract_salary_from_line(line)
                    if salario:
                        self.result['salario_base'] = salario
                        return salario
                    
                    # Buscar salario en las próximas 5 líneas
                    for j in range(1, 6):
                        if i + j < len(self.lines):
                            next_line = self.lines[i + j]
                            salario = self._extract_salary_from_line(next_line)
                            if salario:
                                self.result['salario_base'] = salario
                                return salario
        
        print("No se encontraron patrones de salario, buscando números que parezcan salarios...")
        
        # Búsqueda general: buscar líneas que contengan solo números con formato de salario
        for i, line in enumerate(self.lines):
            clean_line = line.strip()
            # Solo buscar en líneas que parezcan contener únicamente un número de salario
            if re.match(r'^\s*\$?\s*\d{1,3}(?:\.\d{3})+\s*$', clean_line):
                salario = self._extract_salary_from_line(line)
                if salario:
                    self.result['salario_base'] = salario
                    return salario
        
        # Si no se encuentra salario específico, devolver None
        print("No se encontró salario base")
        self.result['salario_base'] = None
        return None
    def _line_contains_irrelevant_content(self, line):
        """Verificar si una línea contiene contenido irrelevante para salarios"""
        
        irrelevant_keywords = [
            'CEDULA', 'IDENTIFICACION', 'APELLIDOS', 'NOMBRES', 'FECHA', 'NACIMIENTO',
            'LUGAR', 'SEXO', 'ESTATURA', 'SANGRE', 'EXPEDICION', 'REGISTRADOR',
            'NACIONAL', 'CODIGO', 'BARRAS', 'HUELLA', 'INDICE', 'FIRMA'
        ]
        
        line_upper = line.upper()
        return any(keyword in line_upper for keyword in irrelevant_keywords)

    def _format_salary_display(self, salary):
        """Formatear salario para mostrar (con puntos de miles)"""
        
        if salary is None:
            return None
        
        # Convertir a string y agregar puntos cada 3 dígitos
        salary_str = str(salary)
        
        # Agregar puntos de derecha a izquierda
        formatted = ""
        for i, digit in enumerate(reversed(salary_str)):
            if i > 0 and i % 3 == 0:
                formatted = "." + formatted
            formatted = digit + formatted
        
        return formatted

    def _is_valid_salary(self, salary_str):
        """Validar que el número extraído sea un salario válido"""
        
        try:
            # Remover puntos y convertir a entero
            salary_number = int(salary_str.replace('.', ''))

            # Validaciones básicas para salarios en Colombia
            # Salario mínimo aproximado: 1.160.000 (2024)
            # Salario máximo razonable: 50.000.000
            if 500000 <= salary_number <= 50000000:
                # Verificar que tenga formato típico de salario colombiano
                # (múltiplos de 1000 generalmente)
                if salary_number % 1000 == 0 or salary_number % 500 == 0:
                    return True
                # También aceptar salarios que terminen en 000
                if str(salary_number).endswith('000'):
                    return True
            
            return False
            
        except (ValueError, AttributeError):
            return False

    def _is_valid_salary_context(self, line):
        """Validar que el contexto sea apropiado para salario"""
        
        # Palabras que indican contexto de salario
        contexto_positivo = [
            'SALARIO', 'SUELDO', 'BASICO', 'BASE', 'MENSUAL',
            'REMUNERACION', 'PAGO', 'DEVENGADO'
        ]
        
        # Palabras que indican otro tipo de cantidad (para evitar falsos positivos)
        contexto_negativo = [
            'CEDULA', 'TELEFONO', 'CELULAR', 'DOCUMENTO',
            'LICENCIA', 'NUMERO', 'CODIGO', 'ID'
        ]
        
        normalized_line = normalize_text(line).upper()
        
        # Verificar contexto negativo primero
        for palabra in contexto_negativo:
            if palabra in normalized_line:
                return False
        
        # Verificar contexto positivo
        for palabra in contexto_positivo:
            if palabra in normalized_line:
                return True
        
        return True  # Si no hay contexto negativo claro, asumir que es válido
    
    def extract_termino_contrato(self):
        """Extraer el término inicial del contrato y fecha de terminación"""
        
        # Patrones para identificar término inicial del contrato
        patrones_termino = [
            'TERMINO INICIAL DEL CONTRATO:',
            'TÉRMINO INICIAL DEL CONTRATO:',
            'TERMINO DEL CONTRATO:',
            'TÉRMINO DEL CONTRATO:',
            'TIPO DE CONTRATO:',
            'MODALIDAD DE CONTRATO:'
        ]
        
        # Patrones para fecha de terminación
        patrones_fecha_terminacion = [
            'FECHA DE TERMINACION:',
            'FECHA DE TERMINACIÓN:',
            'FECHA DE VENCIMIENTO:',
            'FECHA FIN CONTRATO:',
            'FECHA FINAL:'
        ]
        
        termino_inicial = None
        fecha_terminacion = None
        
        # Buscar término inicial del contrato
        for i, line in enumerate(self.lines):
            normalized_line = normalize_text(line).upper()
            
            # Verificar si la línea contiene algún patrón de término inicial
            for patron in patrones_termino:
                if patron in normalized_line:
                    
                    # Buscar término en la misma línea
                    termino = self._extract_termino_from_line(line)
                    if termino:
                        termino_inicial = termino
                        break
                    
                    # Buscar término en las próximas 3 líneas
                    for j in range(1, 4):
                        if i + j < len(self.lines):
                            termino = self._extract_termino_from_line(self.lines[i + j])
                            if termino:
                                termino_inicial = termino
                                break
                    
                    if termino_inicial:
                        break
            
            if termino_inicial:
                break
        
        # Buscar fecha de terminación
        for i, line in enumerate(self.lines):
            normalized_line = normalize_text(line).upper()
            
            # Verificar si la línea contiene algún patrón de fecha de terminación
            for patron in patrones_fecha_terminacion:
                if patron in normalized_line:
                    
                    # Buscar fecha en la misma línea
                    fecha = self._extract_fecha_terminacion_from_line(line)
                    if fecha:
                        fecha_terminacion = fecha
                        break
                    
                    # Buscar fecha en las próximas 3 líneas
                    for j in range(1, 4):
                        if i + j < len(self.lines):
                            fecha = self._extract_fecha_terminacion_from_line(self.lines[i + j])
                            if fecha:
                                fecha_terminacion = fecha
                                break
                    
                    if fecha_terminacion:
                        break
            
            if fecha_terminacion:
                break
        
        # Aplicar lógica de negocio
        if termino_inicial and termino_inicial.upper() == 'INDEFINIDO':
            # Contrato indefinido
            self.result['termino_contrato'] = 'INDEFINIDO'
            self.result['fecha_terminacion'] = 'INDEFINIDO'
        elif termino_inicial and fecha_terminacion:
            # Contrato con término definido y fecha de terminación
            self.result['termino_contrato'] = termino_inicial
            self.result['fecha_terminacion'] = fecha_terminacion
        elif termino_inicial:
            # Solo se encontró término inicial
            self.result['termino_contrato'] = termino_inicial
            self.result['fecha_terminacion'] = None
        else:
            # No se encontró información
            self.result['termino_contrato'] = None
            self.result['fecha_terminacion'] = None
            print("No se encontró información de término de contrato")
        
        return {
            'termino_contrato': self.result.get('termino_contrato'),
            'fecha_terminacion': self.result.get('fecha_terminacion')
        }

    def _extract_termino_from_line(self, line):
        """Extraer término del contrato de una línea específica"""
        
        # Limpiar la línea
        clean_line = line.strip().upper()
        
        # Términos comunes de contrato
        terminos_validos = [
            'INDEFINIDO',
            'DEFINIDO',
            'FIJO',
            'TEMPORAL',
            'OBRA O LABOR',
            'PRESTACION DE SERVICIOS',
            'PRESTACIÓN DE SERVICIOS',
            'APRENDIZAJE',
            'PRUEBA'
        ]
        
        # Buscar términos válidos en la línea
        for termino in terminos_validos:
            if termino in clean_line:
                # Verificar que sea una palabra completa
                if self._is_complete_word(clean_line, termino):
                    return termino
        
        # Buscar patrones numéricos para contratos con duración específica
        # Ej: "12 MESES", "6 MESES", "1 AÑO"
        duration_patterns = [
            r'(\d+)\s+MESES?',
            r'(\d+)\s+AÑOS?',
            r'(\d+)\s+AÑO',
            r'UN\s+AÑO',
            r'DOS\s+AÑOS?',
            r'TRES\s+AÑOS?'
        ]
        
        for pattern in duration_patterns:
            match = re.search(pattern, clean_line)
            if match:
                duration_term = match.group(0)
                return duration_term
        
        return None

    def _extract_fecha_terminacion_from_line(self, line):
        """Extraer fecha de terminación de una línea específica"""
        
        clean_line = line.strip().upper()
        
        # Verificar si es indefinido
        if 'INDEFINIDO' in clean_line or 'INDEFINIDA' in clean_line:
            return 'INDEFINIDO'
        
        # Usar la función existente para extraer fechas
        # Reutilizar la lógica de extracción de fechas ya implementada
        meses = {
            'ENERO': '01', 'FEBRERO': '02', 'MARZO': '03', 'ABRIL': '04',
            'MAYO': '05', 'JUNIO': '06', 'JULIO': '07', 'AGOSTO': '08',
            'SEPTIEMBRE': '09', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12'
        }
        
        # Patrón específico para "DD DE MMMM DE YYYY"
        pattern_de = r'(\d{1,2})\s+DE\s+(\w+)\s+DE\s+(\d{4})'
        match_de = re.search(pattern_de, clean_line)
        if match_de:
            try:
                day, month_name, year = match_de.groups()
                month_name = month_name.upper().strip()
                
                if month_name in meses and day.isdigit() and year.isdigit():
                    day_int = int(day)
                    if 1 <= day_int <= 31:
                        fecha_formateada = f"{day.zfill(2)}/{meses[month_name]}/{year}"
                        return fecha_formateada
            except (ValueError, IndexError):
                pass
        
        # Otros patrones de fecha
        fecha_patterns = [
            r'\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b',  # DD/MM/YYYY
            r'\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b',  # YYYY/MM/DD
        ]
        
        for pattern in fecha_patterns:
            match = re.search(pattern, clean_line)
            if match:
                try:
                    groups = match.groups()
                    if len(groups) == 3:
                        # Determinar formato y validar
                        if len(groups[0]) == 4:  # YYYY/MM/DD
                            year, month, day = groups
                        else:  # DD/MM/YYYY
                            day, month, year = groups
                        
                        if (day.isdigit() and month.isdigit() and year.isdigit() and
                            1 <= int(day) <= 31 and 1 <= int(month) <= 12):
                            fecha_formateada = f"{day.zfill(2)}/{month.zfill(2)}/{year}"
                            return fecha_formateada
                except (ValueError, IndexError):
                    continue
        
        return None

    def _is_complete_word(self, line, word):
        """Verificar que sea una palabra completa"""
        import re
        pattern = r'\b' + re.escape(word) + r'\b'
        return bool(re.search(pattern, line))

    def process(self):
        """Procesar todos los campos y devolver el resultado"""
        if not self.is_valid_contrato ():
            return {"error": "No es un CONTRATO válido"}
        
        self.result['validation'] = self.is_same_conductor()
        self.extract_number_phone()
        self.extract_email()
        self.extract_employer_address()
        self.extract_sede()
        self.extract_fecha_ingreso()
        self.extract_salario_base()
        self.extract_termino_contrato()

        return self.result

# Función principal para procesar el OCR
def process_contrato_data(data, numero_identificacion=None):
    try:
        processor = CONTRATOProcessor(data, numero_identificacion)
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
            file_path = 'temp/tempOcrData_CONTRATO.json'
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
        result = process_contrato_data(data, args.numero_identificacion)
        
        # Imprimir resultado como JSON (único output a stdout)
        print(json.dumps(result, indent=4, ensure_ascii=False))
        
    except Exception as e:
        # Errores a stderr para depuración
        print(f"ERROR inesperado: {str(e)}", file=sys.stderr)
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        
        # Error en formato JSON a stdout para que el proceso JS pueda capturarlo
        print(json.dumps({"error": str(e)}))
        sys.exit(1)