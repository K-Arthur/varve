import importlib.util
import pathlib
import sys
import unittest


SCRIPT = pathlib.Path(__file__).parents[1] / "convert_realesrgan_to_onnx.py"
SPEC = importlib.util.spec_from_file_location("convert_realesrgan", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class ConverterArchitectureTest(unittest.TestCase):
    def test_compact_general_model_is_self_contained_and_scales_four_times(self):
        import torch

        model = MODULE.build_model("srvgg-32")
        output = model(torch.zeros(1, 3, 8, 8))

        self.assertEqual(tuple(output.shape), (1, 3, 32, 32))
        self.assertEqual(len(model.body), 67)


if __name__ == "__main__":
    unittest.main()
