import React from "react";
import { Workspace } from "ui/types";
import { MY_LIBRARY, personalWorkspace } from "./Sharing";

const getIconAndText = (
  isPublic: boolean,
  selectedWorkspaceId: string,
  workspaceName: string
): {
  text: string;
  icon: string;
} => {
  if (isPublic) {
    return {
      text: "This replay can be viewed by anyone with the link",
      icon: "public",
    };
  }

  if (selectedWorkspaceId === MY_LIBRARY) {
    return {
      text: `Only you can view this`,
      icon: "person",
    };
  }

  return {
    text: `Shared privately with ${workspaceName}`,
    icon: "groups",
  };
};

type SettingsPreviewProps = {
  onClick: () => void;
  isPublic: boolean;
  workspaces: Workspace[];
  selectedWorkspaceId: string;
};

export default function SettingsPreview({
  onClick,
  isPublic,
  workspaces,
  selectedWorkspaceId,
}: SettingsPreviewProps) {
  const workspaceName = [...workspaces, personalWorkspace].find(w => w.id === selectedWorkspaceId)!
    .name;

  const { icon, text } = getIconAndText(isPublic, selectedWorkspaceId, workspaceName);

  return (
    <button
      className="w-full flex flex-row justify-between items-center focus:outline-none"
      onClick={onClick}
      style={{ minHeight: "38px" }}
    >
      <div className="space-x-2.5 flex flex-row items-center">
        <span className="material-icons" style={{ fontSize: "24px" }}>
          {icon}
        </span>
        <div className="font-medium">{text}</div>
      </div>
      <div className="space-x-2 flex flex-row items-center text-primaryAccent">
        <div className="font-medium">Edit</div>
        <span className="material-icons" style={{ fontSize: "24px" }}>
          edit
        </span>
      </div>
    </button>
  );
}
