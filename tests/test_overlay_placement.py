from overlay_placement import (
    center_for_mode,
    face_index_from_prompt,
    list_faces,
    map_center_analysis_to_deliverable,
    merge_face_overrides,
    mode_from_prompt,
    _map_face_index_h_to_v,
    _primary_face,
)


def test_mode_from_prompt_keywords():
    assert mode_from_prompt("stick on their face") == "on_face"
    assert mode_from_prompt("above the speaker") == "above_face"
    assert mode_from_prompt("keep text away from face") == "avoid_faces"
    assert mode_from_prompt("follow the main face") == "track_face"


def test_primary_face_picks_largest_cluster():
    frames = [
        [(0.1, 0.2, 0.2, 0.35)],
        [(0.11, 0.21, 0.21, 0.36)],
        [(0.7, 0.5, 0.75, 0.6)],
    ]
    face = _primary_face(frames)
    assert face is not None
    assert face[0] < 0.3


def test_center_above_face():
    face = (0.4, 0.3, 0.6, 0.55)
    cx, cy = center_for_mode("above_face", face, 0.8, 0.1)
    assert abs(cx - 0.5) < 0.01
    assert cy < face[1]


def test_list_faces_left_to_right():
    frames = [
        [(0.6, 0.2, 0.7, 0.4), (0.1, 0.2, 0.2, 0.4)],
        [(0.62, 0.21, 0.72, 0.41), (0.11, 0.21, 0.21, 0.41)],
    ]
    people = list_faces(frames)
    assert len(people) == 2
    assert people[0]["label"] == "left"
    assert people[1]["label"] == "right"


def test_merge_face_overrides():
    people = [{"id": 0, "label": "left", "x0": 0.1, "y0": 0.2, "x1": 0.3, "y1": 0.5,
               "center_x": 0.2, "center_y": 0.35, "area": 0.06, "detections": 2}]
    out = merge_face_overrides(people, [{"id": 0, "x0": 0.05, "y0": 0.15, "x1": 0.4, "y1": 0.55}])
    assert out[0]["x0"] == 0.05
    assert out[0]["x1"] == 0.4


def test_map_face_index_two_shot():
    h_faces = [
        {"id": 0, "label": "left", "center_x": 0.25, "center_y": 0.4,
         "x0": 0.1, "y0": 0.2, "x1": 0.4, "y1": 0.6},
        {"id": 1, "label": "right", "center_x": 0.75, "center_y": 0.4,
         "x0": 0.6, "y0": 0.2, "x1": 0.9, "y1": 0.6},
    ]
    v_faces = [
        {"id": 0, "label": "left", "center_x": 0.5, "center_y": 0.3,
         "x0": 0.3, "y0": 0.1, "x1": 0.7, "y1": 0.5},
        {"id": 1, "label": "right", "center_x": 0.5, "center_y": 0.7,
         "x0": 0.3, "y0": 0.5, "x1": 0.7, "y1": 0.9},
    ]
    assert _map_face_index_h_to_v(0, h_faces, v_faces) == 0
    assert _map_face_index_h_to_v(1, h_faces, v_faces) == 1


def test_map_center_offset():
    h = {"center_x": 0.3, "center_y": 0.2}
    v = {"center_x": 0.5, "center_y": 0.4}
    cx, cy = map_center_analysis_to_deliverable(0.3, 0.1, h, v, 0.5, 0.1)
    assert abs(cx - 0.5) < 0.01
    assert cy < 0.4


def test_face_index_from_prompt():
    people = [
        {"id": 0, "label": "left", "area": 0.1, "detections": 2},
        {"id": 1, "label": "right", "area": 0.2, "detections": 3},
    ]
    assert face_index_from_prompt("hook above right person", people) == 1
    assert face_index_from_prompt("logo on person 1", people) == 0
    assert face_index_from_prompt("largest face", people) == 1