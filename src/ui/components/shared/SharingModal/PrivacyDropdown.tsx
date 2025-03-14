import React, { useState } from "react";
import PortalDropdown from "../PortalDropdown";
import { Dropdown, DropdownItem, DropdownItemContent } from "ui/components/Library/LibraryDropdown";
import { WorkspaceId } from "ui/state/app";
import { Recording } from "ui/types";
import hooks from "ui/hooks";
import MaterialIcon from "../MaterialIcon";
import { trackEvent } from "ui/utils/telemetry";

export default function PrivacyDropdown({ recording }: { recording: Recording }) {
  const [expanded, setExpanded] = useState(false);
  const isPrivate = recording.private;
  const toggleIsPrivate = hooks.useToggleIsPrivate(recording.id, isPrivate);
  const updateRecordingWorkspace = hooks.useUpdateRecordingWorkspace(false);
  const { workspaces } = hooks.useGetNonPendingWorkspaces();
  const workspaceId = recording.workspace?.id || null;
  const isOwner = hooks.useIsOwner(recording.id || "00000000-0000-0000-0000-000000000000");

  const setPublic = () => {
    trackEvent("share_modal.set_public");
    if (isPrivate) {
      toggleIsPrivate();
    }
    setExpanded(false);
  };
  const setPrivate = () => {
    trackEvent("share_modal.set_private");
    if (!isPrivate) {
      toggleIsPrivate();
    }
    setExpanded(false);
  };
  const handleMoveToTeam = (targetWorkspaceId: WorkspaceId | null) => {
    if (targetWorkspaceId !== workspaceId) {
      trackEvent("share_modal.set_team");
      updateRecordingWorkspace(recording.id, workspaceId, targetWorkspaceId);
    }

    setPrivate();
    setExpanded(false);
  };

  const button = (
    <div className="flex flex-row space-x-1">
      <span className="text-xs overflow-hidden overflow-ellipsis whitespace-pre">
        {!isPrivate ? (
          "Anyone with the link can view"
        ) : workspaceId ? (
          <span>
            {`Members of `}
            <span className="underline">{recording.workspace?.name}</span>
            {` can view`}
          </span>
        ) : (
          "Only people with access can view"
        )}
      </span>
      {isOwner ? (
        <div style={{ lineHeight: "0px" }}>
          <MaterialIcon style={{ fontSize: "16px" }}>expand_more</MaterialIcon>
        </div>
      ) : null}
    </div>
  );

  if (!isOwner) {
    return (
      <button disabled className="cursor-default" title="Only the owner can modify these settings">
        {button}
      </button>
    );
  }

  return (
    <PortalDropdown
      buttonContent={button}
      buttonStyle={"overflow-hidden"}
      setExpanded={setExpanded}
      expanded={expanded}
      distance={0}
      position="bottom-right"
    >
      <Dropdown menuItemsClassName="z-50 overflow-auto max-h-48" widthClass="w-80">
        <DropdownItem onClick={setPublic}>
          <DropdownItemContent icon="link" selected={!isPrivate}>
            Anyone with the link
          </DropdownItemContent>
        </DropdownItem>
        <DropdownItem onClick={() => handleMoveToTeam(null)}>
          <DropdownItemContent icon="domain" selected={isPrivate && !workspaceId}>
            Only people with access
          </DropdownItemContent>
        </DropdownItem>
        <div>
          {workspaces.map(({ id, name }) => (
            <DropdownItem onClick={() => handleMoveToTeam(id)} key={id}>
              <DropdownItemContent icon="group" selected={isPrivate && id === workspaceId}>
                <span className="overflow-hidden overflow-ellipsis whitespace-pre">
                  Members of {name}
                </span>
              </DropdownItemContent>
            </DropdownItem>
          ))}
        </div>
      </Dropdown>
    </PortalDropdown>
  );
}
