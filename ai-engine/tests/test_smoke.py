from prompts import DEFECT_TYPES


def test_taxonomy_has_five_types():
    assert len(DEFECT_TYPES) == 5
    