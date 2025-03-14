import React, { useEffect } from "react";
import { useGetRecording, useGetRecordingId } from "ui/hooks/recordings";
import { useGetUserSettings } from "ui/hooks/settings";
import BlankScreen, { LoadingScreen } from "ui/components/shared/BlankScreen";
import UploadScreen from "ui/components/UploadScreen";

function UploadScreenWrapper() {
  const recordingId = useGetRecordingId();
  const { recording } = useGetRecording(recordingId);
  // Make sure to get the user's settings before showing the upload screen.
  const { userSettings, loading } = useGetUserSettings();

  useEffect(() => {
    if (recording?.isInitialized) {
      window.onbeforeunload = null;
      document.location.reload();
    }
  });

  if (loading) {
    return <LoadingScreen />;
  }

  return recording ? <UploadScreen {...{ userSettings, recording }} /> : <BlankScreen />;
}

export default UploadScreenWrapper;
