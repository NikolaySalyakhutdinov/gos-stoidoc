import xml.etree.ElementTree as ET


class XMLParser:

    def parse(self, file_path: str):

        tree = ET.parse(file_path)

        root = tree.getroot()

        data = self._parse_element(root)

        return {

            "type": "xml",

            "root": root.tag,

            "data": data
        }

    def _parse_element(self, element):

        result = {

            "tag": element.tag,

            "attributes": dict(
                element.attrib
            ),

            "text": (
                element.text.strip()
                if element.text
                else ""
            ),

            "children": []
        }

        for child in element:

            result["children"].append(
                self._parse_element(child)
            )

        return result
