import React from "react";
import * as styles from "./display.module.css";

const Display = props => {
  let content = 0;

  if (props.content) {
    content = props.content;
  }
  return (
    <div className={styles.display}>
      <p>{content}</p>
    </div>
  );
};

export default Display;
