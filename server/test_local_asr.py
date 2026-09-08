import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("local_asr", Path(__file__).with_name("local-asr.py"))
asr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asr)


class RecordingBoundaryTest(unittest.TestCase):
    def test_only_bounded_existing_m4a_in_staging_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            asr.ROOT = Path(directory)
            staging = asr.ROOT / "capture-audio"
            staging.mkdir()
            audio = staging / "recording.m4a"
            audio.write_bytes(b"recording")
            self.assertEqual(asr.recording_path(str(audio)), audio.resolve())
            outside = asr.ROOT / "outside.m4a"
            outside.write_bytes(b"recording")
            link = staging / "escape.m4a"
            link.symlink_to(outside)
            empty = staging / "empty.m4a"
            empty.touch()
            for candidate in [str(outside), str(link), str(empty), None]:
                with self.assertRaises(ValueError):
                    asr.recording_path(candidate)
            with audio.open("wb") as f:
                f.truncate(5 * 1024 * 1024 + 1)
            with self.assertRaises(ValueError):
                asr.recording_path(str(audio))


if __name__ == "__main__":
    unittest.main()
