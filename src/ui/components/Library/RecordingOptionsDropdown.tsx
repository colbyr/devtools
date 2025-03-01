import React, { useState } from "react";
import { connect, ConnectedProps } from "react-redux";
import { selectors } from "ui/reducers";
import { actions } from "ui/actions";
import { UIState } from "ui/state";
import { Recording } from "ui/types";
import MaterialIcon from "../shared/MaterialIcon";
import hooks from "ui/hooks";
import { RecordingId } from "@recordreplay/protocol";
import { WorkspaceId } from "ui/state/app";
import { Dropdown, DropdownDivider, DropdownItem } from "./LibraryDropdown";
import PortalDropdown from "../shared/PortalDropdown";
import classNames from "classnames";
import MoveRecordingMenu from "./MoveRecordingMenu";

type RecordingOptionsDropdownProps = PropsFromRedux & {
  recording: Recording;
};

function RecordingOptionsDropdown({
  currentWorkspaceId,
  recording,
  setModal,
}: RecordingOptionsDropdownProps) {
  const [isPrivate, setIsPrivate] = useState(recording.private);
  const [expanded, setExpanded] = useState(false);
  const deleteRecording = hooks.useDeleteRecordingFromLibrary();
  const { workspaces, loading } = hooks.useGetNonPendingWorkspaces();
  const updateRecordingWorkspace = hooks.useUpdateRecordingWorkspace();
  const updateIsPrivate = hooks.useUpdateIsPrivate();
  const recordingId = recording.id;

  const toggleIsPrivate = () => {
    setIsPrivate(!isPrivate);
    updateIsPrivate({ variables: { recordingId: recording.id, isPrivate: !isPrivate } });
    setExpanded(false);
  };
  const onDeleteRecording = (recordingId: RecordingId) => {
    const message =
      "This action will permanently delete this replay. \n\nAre you sure you want to proceed?";

    if (window.confirm(message)) {
      deleteRecording(recordingId, currentWorkspaceId);
    }
    setExpanded(false);
  };
  const updateRecording = (targetWorkspaceId: WorkspaceId | null) => {
    updateRecordingWorkspace(recordingId, currentWorkspaceId, targetWorkspaceId);
    setExpanded(false);
  };
  const handleShareClick = () => {
    setModal("sharing", { recordingId });
    setExpanded(false);
  };

  const button = (
    <MaterialIcon
      outlined
      className={classNames(
        expanded ? "opacity-100" : "",
        "h-4 w-4 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-primaryAccentHover text-base leading-4"
      )}
    >
      more_vert
    </MaterialIcon>
  );

  return (
    <PortalDropdown
      buttonContent={button}
      setExpanded={setExpanded}
      expanded={expanded}
      buttonStyle=""
      distance={0}
    >
      <Dropdown>
        <DropdownItem onClick={() => onDeleteRecording(recordingId)}>Delete</DropdownItem>
        <DropdownItem onClick={toggleIsPrivate}>{`Make ${
          isPrivate ? "public" : "private"
        }`}</DropdownItem>
        <DropdownItem onClick={handleShareClick}>Share</DropdownItem>
        {!loading ? (
          <MoveRecordingMenu workspaces={workspaces} onMoveRecording={updateRecording} />
        ) : null}
      </Dropdown>
    </PortalDropdown>
  );
}

const connector = connect(
  (state: UIState) => ({ currentWorkspaceId: selectors.getWorkspaceId(state) }),
  {
    setModal: actions.setModal,
  }
);
type PropsFromRedux = ConnectedProps<typeof connector>;
export default connector(RecordingOptionsDropdown);
