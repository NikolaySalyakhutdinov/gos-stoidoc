import cv2
import numpy as np


class ImageProcessor:
    """
    Подготовка изображений документов перед OCR.
    """

    @staticmethod
    def to_gray(image: np.ndarray) -> np.ndarray:
        if len(image.shape) == 2:
            return image

        return cv2.cvtColor(
            image,
            cv2.COLOR_BGR2GRAY
        )

    @staticmethod
    def denoise(image: np.ndarray) -> np.ndarray:
        """
        Убираем небольшой шум.
        """

        return cv2.fastNlMeansDenoising(
            image,
            None,
            h=10,
            templateWindowSize=7,
            searchWindowSize=21
        )

    @staticmethod
    def binarize(image: np.ndarray) -> np.ndarray:
        """
        Переводим изображение в чёрно-белое.
        """

        _, binary = cv2.threshold(
            image,
            0,
            255,
            cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )

        return binary

    def preprocess(self, image: np.ndarray) -> np.ndarray:
        """
        Полный pipeline подготовки изображения.
        """

        gray = self.to_gray(image)

        gray = self.denoise(gray)

        binary = self.binarize(gray)

        return binary
