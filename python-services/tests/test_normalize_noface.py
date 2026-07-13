import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from normalize_noface import normalize_noface


class NormalizeNofaceTest(unittest.TestCase):
    def test_normalize_noface_元衣装の寸法とアルファを復元すること(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source_path = Path(temp_dir) / "source.png"
            noface_path = Path(temp_dir) / "noface.png"

            source = np.zeros((6, 4, 4), dtype=np.uint8)
            source[:, :, :3] = [10, 20, 30]
            source[1:5, 1:3, 3] = 255
            noface = np.full((3, 2, 3), 200, dtype=np.uint8)
            cv2.imwrite(str(source_path), source)
            cv2.imwrite(str(noface_path), noface)

            result = normalize_noface(str(source_path), str(noface_path))
            normalized = cv2.imread(str(noface_path), cv2.IMREAD_UNCHANGED)

            self.assertTrue(result["success"])
            self.assertEqual(normalized.shape, source.shape)
            np.testing.assert_array_equal(normalized[:, :, 3], source[:, :, 3])


if __name__ == "__main__":
    unittest.main()
