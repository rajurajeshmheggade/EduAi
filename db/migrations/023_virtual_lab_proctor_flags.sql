-- Virtual Labs: a running count of the light, on-device camera/mic check flags raised during a lab attempt
-- (see frontend VivaProctor — multiple people, no one in frame, phone/laptop/TV in shot, background noise).
-- Only a count is kept, so the teacher can see something was flagged without this becoming a surveillance
-- record: no video, audio, image or flag-by-flag detail is stored anywhere.

ALTER TABLE public.virtual_lab_attempts
    ADD COLUMN IF NOT EXISTS proctor_flag_count INT NOT NULL DEFAULT 0 CHECK (proctor_flag_count >= 0);
