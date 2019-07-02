import React from "react";
import styles from "./button.module.css";

const Button = props => {
  return (
    <button
      className={styles.button}
      onClick={() => props.onClick(props.content)}
    >
      {props.content}
    </button>
  );
};

export default Button;
